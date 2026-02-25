import { execSync } from 'child_process';
import { getRpcUrl } from '../config.js';

function isCastAvailable(): boolean {
  try {
    execSync('cast --version', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Replay a transaction with Foundry's cast run to get a full execution trace. */
export function castRun(txHash: string, networkId: number): string {
  if (!isCastAvailable()) {
    return 'cast CLI not available. Install Foundry: https://getfoundry.sh';
  }

  try {
    const rpcUrl = getRpcUrl(String(networkId));
    const output = execSync(
      `cast run ${txHash} --rpc-url "${rpcUrl}"`,
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }
    ).toString();
    // Cap output to avoid flooding the LLM context
    return output.length > 8000 ? output.slice(0, 8000) + '\n... (truncated)' : output;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `cast run failed: ${msg}`.slice(0, 2000);
  }
}

/**
 * Execute a static (read-only) call to a contract at a specific block.
 * Useful for querying on-chain state at the exact moment the transaction occurred.
 * Example: castCall("0xToken", "allowance(address,address)", ["0xOwner","0xSpender"], 1, 19481234)
 */
export function castCall(
  address: string,
  functionSignature: string,
  args: string[],
  networkId: number,
  blockNumber: number,
): string {
  if (!isCastAvailable()) {
    return 'cast CLI not available. Install Foundry: https://getfoundry.sh';
  }

  try {
    const rpcUrl = getRpcUrl(String(networkId));
    const argsStr = args.map(a => `"${a}"`).join(' ');
    const output = execSync(
      `cast call ${address} "${functionSignature}" ${argsStr} --rpc-url "${rpcUrl}" --block ${blockNumber}`,
      { timeout: 15_000 }
    ).toString().trim();
    return output || '(empty response)';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `cast call failed: ${msg}`.slice(0, 1000);
  }
}
