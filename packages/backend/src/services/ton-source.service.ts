/**
 * TON contract source code resolution:
 * 1. Try verified source from verifier.ton.org (FunC/Tact/Tolk)
 * 2. Fallback: decompile bytecode to TVM assembly
 *
 * Uses: @ton-community/contract-verifier-sdk + @tact-lang/opcode
 */

import { getTonApiBaseUrl, getTonApiHeaders } from '../config.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContractSource {
  /** 'verified-func' | 'verified-tact' | 'verified-tolk' | 'decompiled' */
  type: string;
  /** Compiler used (func, tact, tolk, fift) or 'decompiled' */
  compiler: string;
  /** Source files or decompiled assembly */
  files: { name: string; content: string }[];
  /** Code cell hash used for lookup */
  codeHash: string;
  /** Verification date if verified */
  verifiedAt?: string;
}

// ─── Fetch code BOC + compute hash from TonAPI ──────────────────────────────

async function getContractCode(
  address: string,
  networkId: string,
): Promise<{ codeBoc: string; codeHash: string } | null> {
  try {
    const baseUrl = getTonApiBaseUrl(networkId);
    const headers = getTonApiHeaders();
    const res = await fetch(`${baseUrl}/v2/blockchain/accounts/${address}`, {
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { code?: string; status?: string };
    if (!data.code) return null;

    // TonAPI returns code as hex-encoded BOC
    const { Cell } = await import('@ton/core');
    const cell = Cell.fromHex(data.code);
    const codeHash = cell.hash().toString('hex');

    // Convert to base64 for the decompiler
    const codeBoc = cell.toBoc().toString('base64');

    return { codeBoc, codeHash };
  } catch {
    return null;
  }
}

// ─── Verified source lookup ──────────────────────────────────────────────────

async function fetchVerifiedSource(
  codeHashHex: string,
  networkId: string,
): Promise<ContractSource | null> {
  try {
    const { ContractVerifier } = await import('@ton-community/contract-verifier-sdk');
    const isTestnet = networkId === 'ton-testnet';

    // The verifier SDK expects code hash as base64
    const codeHashBase64 = Buffer.from(codeHashHex, 'hex').toString('base64');

    const endpoint = isTestnet
      ? 'https://testnet-v4.tonhubapi.com'
      : 'https://mainnet-v4.tonhubapi.com';

    const url = await ContractVerifier.getSourcesJsonUrl(codeHashBase64, {
      testnet: isTestnet,
      httpApiEndpointV4: endpoint,
    });
    if (!url) return null;

    const data = await ContractVerifier.getSourcesData(url, { testnet: isTestnet });

    return {
      type: `verified-${data.compiler}`,
      compiler: data.compiler,
      files: data.files.map(f => ({ name: f.name, content: f.content })),
      codeHash: codeHashHex,
      verifiedAt: data.verificationDate?.toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Bytecode decompilation fallback ─────────────────────────────────────────

async function decompileBytecode(codeBoc: string): Promise<ContractSource | null> {
  try {
    const { disassembleRawRoot, AssemblyWriter, Cell } = await import('@tact-lang/opcode');

    const cell = Cell.fromBase64(codeBoc);
    const program = disassembleRawRoot(cell);
    const assembly = AssemblyWriter.write(program, {});

    // Trim to reasonable size for LLM context
    const lines = assembly.split('\n');
    const trimmed = lines.length > 200
      ? lines.slice(0, 200).join('\n') + `\n\n... (${lines.length - 200} more lines)`
      : assembly;

    return {
      type: 'decompiled',
      compiler: 'decompiled',
      files: [{ name: 'contract.fift', content: trimmed }],
      codeHash: '',
    };
  } catch (err) {
    console.warn('[ton-source] Decompilation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve source code for a contract address.
 * Tries verified source first, falls back to bytecode decompilation.
 */
export async function resolveContractSource(
  address: string,
  networkId: string,
): Promise<ContractSource | null> {
  // Step 1: Get code BOC + hash
  const codeInfo = await getContractCode(address, networkId);
  if (!codeInfo) return null;

  // Step 2: Try verified source
  const verified = await fetchVerifiedSource(codeInfo.codeHash, networkId);
  if (verified) return verified;

  // Step 3: Fallback to decompilation
  const decompiled = await decompileBytecode(codeInfo.codeBoc);
  if (decompiled) decompiled.codeHash = codeInfo.codeHash;
  return decompiled;
}

/**
 * Format contract source for LLM prompt context.
 */
export function formatSourceForPrompt(source: ContractSource | null, address: string): string {
  if (!source) return '';

  const label = source.type.startsWith('verified')
    ? `Verified ${source.compiler.toUpperCase()} source`
    : 'Decompiled TVM assembly';

  const lines = [`### Contract source: ${address.slice(0, 16)}... (${label})`];

  for (const file of source.files) {
    lines.push(`\n#### ${file.name}`);
    lines.push('```');
    lines.push(file.content);
    lines.push('```');
  }

  return lines.join('\n');
}
