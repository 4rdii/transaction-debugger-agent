import { execFile } from 'child_process';
import { getRpcUrl } from '../config.js';

function isCastAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    const child = execFile('cast', ['--version'], { timeout: 3000 }, err => {
      resolve(!err);
    });
    child.stdin?.end();
  });
}

function runCommand(cmd: string, args: string[], timeout: number, maxBuffer?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: maxBuffer ?? 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** Replay a transaction with Foundry's cast run to get a full execution trace. */
export async function castRun(txHash: string, networkId: number): Promise<string> {
  if (!(await isCastAvailable())) {
    return 'cast CLI not available. Install Foundry: https://getfoundry.sh';
  }

  try {
    const rpcUrl = getRpcUrl(String(networkId));
    const output = await runCommand(
      'cast',
      ['run', txHash, '--rpc-url', rpcUrl],
      30_000,
      2 * 1024 * 1024,
    );
    // Cap output to avoid flooding the LLM context
    return output.length > 8000 ? output.slice(0, 8000) + '\n... (truncated)' : output;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `cast run failed: ${msg}`.slice(0, 2000);
  }
}

/**
 * Execute a static (read-only) call to a contract at a specific block using Foundry cast.
 * Useful for querying on-chain state at the exact moment the transaction occurred.
 * Example: castCall("0xToken", "allowance(address,address)", ["0xOwner","0xSpender"], 1, 19481234)
 */
export async function castCall(
  address: string,
  functionSignature: string,
  args: string[],
  networkId: number,
  blockNumber: number,
): Promise<string> {
  if (!(await isCastAvailable())) {
    return 'cast CLI not available. Install Foundry: https://getfoundry.sh';
  }

  try {
    const rpcUrl = getRpcUrl(String(networkId));
    const output = await runCommand(
      'cast',
      ['call', address, functionSignature, ...args, '--rpc-url', rpcUrl, '--block', String(blockNumber)],
      15_000,
    );
    return output.trim() || '(empty response)';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `cast call failed: ${msg}`.slice(0, 1000);
  }
}
