import { config } from '../config.js';

export interface SourceFile {
  name: string;
  content: string;
}

export interface ContractSource {
  contractName: string;
  compilerVersion: string;
  files: SourceFile[];
}

// All chains use the Etherscan V2 unified API (single key, chainid param)
// https://api.etherscan.io/v2/api?chainid=<id>&...&apikey=<etherscan_key>
function buildApiUrl(
  networkId: number,
  params: Record<string, string>,
  apiKey: string,
): string {
  const q = new URLSearchParams({ chainid: String(networkId), ...params, apikey: apiKey });
  return `https://api.etherscan.io/v2/api?${q}`;
}

export async function getContractAbi(address: string, networkId: number): Promise<string> {
  const apiKey = config.etherscan.apiKey;
  if (!apiKey) return 'ETHERSCAN_API_KEY not configured — ABI lookup unavailable.';

  const url = buildApiUrl(networkId, { module: 'contract', action: 'getabi', address }, apiKey);

  try {
    const res = await fetch(url);
    const data = await res.json() as { status: string; result: string; message: string };

    if (data.status !== '1') {
      return `ABI not available for ${address}: ${data.message ?? data.result}`;
    }

    const abi = JSON.parse(data.result) as Array<Record<string, unknown>>;
    const functions = abi
      .filter(item => item['type'] === 'function')
      .map(item => {
        const inputs = (item['inputs'] as Array<{ type: string; name: string }> ?? [])
          .map(i => `${i.type} ${i.name}`).join(', ');
        const outputs = (item['outputs'] as Array<{ type: string }> ?? [])
          .map(o => o.type).join(', ');
        return `  ${item['name']}(${inputs})${outputs ? ` → (${outputs})` : ''}`;
      })
      .join('\n');

    const events = abi
      .filter(item => item['type'] === 'event')
      .map(item => {
        const inputs = (item['inputs'] as Array<{ type: string; name: string }> ?? [])
          .map(i => `${i.type} ${i.name}`).join(', ');
        return `  event ${item['name']}(${inputs})`;
      })
      .join('\n');

    const sections: string[] = [`ABI for ${address} (network ${networkId}):`];
    if (functions) sections.push(`Functions:\n${functions}`);
    if (events) sections.push(`Events:\n${events}`);
    if (!functions && !events) sections.push('No public functions or events found.');

    return sections.join('\n\n');
  } catch (err) {
    return `Failed to fetch ABI for ${address}: ${String(err)}`;
  }
}

export async function getContractSource(
  address: string,
  networkId: number,
): Promise<ContractSource | string> {
  const apiKey = config.etherscan.apiKey;
  if (!apiKey) return 'ETHERSCAN_API_KEY not configured — source lookup unavailable.';

  const url = buildApiUrl(
    networkId,
    { module: 'contract', action: 'getsourcecode', address },
    apiKey,
  );
  try {
    const res = await fetch(url);
    const data = await res.json() as {
      status: string;
      message: string;
      result: Array<Record<string, string>>;
    };

    if (data.status !== '1' || !data.result?.length) {
      return `Source not available for ${address}: ${data.message} — ${Array.isArray(data.result) ? JSON.stringify(data.result) : data.result}`;
    }

    const entry = data.result[0] as Record<string, string>;
    const contractName = entry['ContractName'] ?? 'Unknown';
    const compilerVersion = entry['CompilerVersion'] ?? '';
    const rawSource = entry['SourceCode'] ?? '';

    if (!rawSource) return `No source code found for ${address} (contract may not be verified).`;

    const files: SourceFile[] = [];

    // Etherscan multi-file format wraps Standard Input JSON in an extra pair of braces: {{ ... }}
    if (rawSource.startsWith('{{')) {
      try {
        const inner = rawSource.slice(1, -1);
        const parsed = JSON.parse(inner) as { sources: Record<string, { content: string }> };
        for (const [name, file] of Object.entries(parsed.sources ?? {})) {
          files.push({ name, content: file.content });
        }
      } catch {
        files.push({ name: `${contractName}.sol`, content: rawSource });
      }
    } else if (rawSource.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawSource) as { sources?: Record<string, { content: string }> };
        if (parsed.sources) {
          for (const [name, file] of Object.entries(parsed.sources)) {
            files.push({ name, content: file.content });
          }
        } else {
          files.push({ name: `${contractName}.sol`, content: rawSource });
        }
      } catch {
        files.push({ name: `${contractName}.sol`, content: rawSource });
      }
    } else {
      files.push({ name: `${contractName}.sol`, content: rawSource });
    }

    return { contractName, compilerVersion, files };
  } catch (err) {
    return `Failed to fetch source for ${address}: ${String(err)}`;
  }
}
