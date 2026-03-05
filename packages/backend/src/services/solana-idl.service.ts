import { createHash, createPublicKey } from 'crypto';
import { inflateSync } from 'zlib';
import { getSolanaRpcUrl } from '../config.js';
import { lookupKnownError, hasKnownErrors } from '../registry/solana-errors.js';
import type { ProgramError } from '../registry/solana-errors.js';

// ─── Base58 codec (no external dependency) ───────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Buffer {
  const bytes: number[] = [0];
  for (const char of str) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) throw new Error(`Invalid base58 character: ${char}`);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's in base58 = leading zero bytes
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

function base58Encode(buf: Buffer): string {
  let num = BigInt('0x' + buf.toString('hex'));
  const result: string[] = [];
  while (num > 0n) {
    result.push(BASE58_ALPHABET[Number(num % 58n)]);
    num /= 58n;
  }
  // Leading zero bytes
  for (const byte of buf) {
    if (byte !== 0) break;
    result.push('1');
  }
  return result.reverse().join('');
}

// ─── Ed25519 curve check ─────────────────────────────────────────────────────

/** Check if 32 bytes represent a valid Ed25519 point (on the curve). */
function isOnCurve(bytes: Buffer): boolean {
  try {
    // DER-encoded SPKI prefix for Ed25519 public keys
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    createPublicKey({
      key: Buffer.concat([derPrefix, bytes]),
      format: 'der',
      type: 'spki',
    });
    return true;
  } catch {
    return false;
  }
}

// ─── PDA derivation ──────────────────────────────────────────────────────────

/**
 * Find a Program Derived Address (PDA).
 * Equivalent to PublicKey.findProgramAddressSync() from @solana/web3.js.
 */
function findProgramAddress(seeds: Buffer[], programId: Buffer): Buffer {
  const PDA_MARKER = Buffer.from('ProgramDerivedAddress');

  for (let nonce = 255; nonce >= 0; nonce--) {
    const hash = createHash('sha256')
      .update(Buffer.concat([...seeds, Buffer.from([nonce]), programId, PDA_MARKER]))
      .digest();

    if (!isOnCurve(hash)) {
      return hash;
    }
  }
  throw new Error('Could not find PDA');
}

/**
 * Get the Anchor IDL account address for a given program ID.
 * The IDL is stored at PDA(["anchor:idl", programId], programId).
 */
function getIdlAddress(programIdBase58: string): string {
  const programId = base58Decode(programIdBase58);
  // Ensure exactly 32 bytes (base58 decode can produce variable lengths)
  const programIdBytes = Buffer.alloc(32);
  programId.copy(programIdBytes, 32 - programId.length);

  const seed = Buffer.from('anchor:idl');
  const pda = findProgramAddress([seed, programIdBytes], programIdBytes);
  return base58Encode(pda);
}

// ─── Anchor IDL types ────────────────────────────────────────────────────────

interface AnchorIdlError {
  code: number;
  name: string;
  msg?: string;
}

interface AnchorIdl {
  version: string;
  name: string;
  errors?: AnchorIdlError[];
}

// ─── IDL cache ───────────────────────────────────────────────────────────────

const idlCache = new Map<string, AnchorIdl | null>();

// ─── Fetch IDL from chain ────────────────────────────────────────────────────

async function fetchAnchorIdl(
  programIdBase58: string,
  networkId: string,
): Promise<AnchorIdl | null> {
  // Check cache first
  const cacheKey = `${programIdBase58}-${networkId}`;
  if (idlCache.has(cacheKey)) return idlCache.get(cacheKey) ?? null;

  try {
    const idlAddress = getIdlAddress(programIdBase58);
    const rpcUrl = getSolanaRpcUrl(networkId);

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [idlAddress, { encoding: 'base64' }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      idlCache.set(cacheKey, null);
      return null;
    }

    const json = (await res.json()) as {
      result: { value: { data: [string, string] } | null } | null;
    };

    const accountData = json.result?.value?.data;
    if (!accountData || !accountData[0]) {
      idlCache.set(cacheKey, null);
      return null;
    }

    const rawData = Buffer.from(accountData[0], 'base64');

    // Anchor IDL account layout:
    // 8 bytes: discriminator
    // 32 bytes: authority pubkey
    // 4 bytes: data length (little-endian u32)
    // N bytes: zlib-compressed IDL JSON
    if (rawData.length < 44) {
      idlCache.set(cacheKey, null);
      return null;
    }

    const compressedStart = 44;
    const compressed = rawData.subarray(compressedStart);

    const decompressed = inflateSync(compressed);
    const idl = JSON.parse(decompressed.toString('utf8')) as AnchorIdl;

    idlCache.set(cacheKey, idl);
    return idl;
  } catch (err) {
    console.warn(`[solana-idl] Failed to fetch IDL for ${programIdBase58}:`, err);
    idlCache.set(cacheKey, null);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse the InstructionError from meta.err to extract the failing instruction
 * index and custom error code.
 *
 * Common formats:
 *   { InstructionError: [2, { Custom: 6001 }] }
 *   { InstructionError: [0, "InvalidAccountData"] }
 */
export function parseInstructionError(
  err: unknown,
): { instructionIndex: number; customCode?: number; builtinError?: string } | null {
  if (!err || typeof err !== 'object') return null;

  const obj = err as Record<string, unknown>;
  const ie = obj['InstructionError'];
  if (!Array.isArray(ie) || ie.length < 2) return null;

  const instructionIndex = typeof ie[0] === 'number' ? ie[0] : 0;
  const errDetail = ie[1];

  if (typeof errDetail === 'string') {
    return { instructionIndex, builtinError: errDetail };
  }

  if (typeof errDetail === 'object' && errDetail !== null) {
    const detail = errDetail as Record<string, unknown>;
    if (typeof detail['Custom'] === 'number') {
      return { instructionIndex, customCode: detail['Custom'] };
    }
  }

  return { instructionIndex };
}

/**
 * Look up a Solana program error code.
 * 1. Checks the known error registry (instant, no network call)
 * 2. Falls back to fetching the Anchor IDL from chain
 * Returns a human-readable error, or null if unknown.
 */
export async function lookupProgramError(
  programId: string,
  errorCode: number,
  networkId: string,
): Promise<ProgramError | null> {
  // 1. Check known errors (fast path)
  const known = lookupKnownError(programId, errorCode);
  if (known) return known;

  // 2. Try fetching Anchor IDL from chain
  const idl = await fetchAnchorIdl(programId, networkId);
  if (idl?.errors) {
    const err = idl.errors.find(e => e.code === errorCode);
    if (err) {
      return {
        name: err.name,
        message: err.msg ?? err.name,
      };
    }
  }

  return null;
}

/**
 * Resolve the failing program ID from the transaction's instruction list
 * given an instruction index.
 */
export function getFailingProgramId(
  instructions: Array<{ programId: string }>,
  instructionIndex: number,
): string | undefined {
  return instructions[instructionIndex]?.programId;
}
