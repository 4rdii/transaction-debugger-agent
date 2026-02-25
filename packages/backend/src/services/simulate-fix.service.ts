import { ethers } from 'ethers';
import { simulateWithOverrides } from './tenderly.service.js';
import { normalizeCallTrace } from './normalizer.service.js';
import type { RawTxParams } from './ethers.service.js';

const MAX_UINT256 = '0x' + 'f'.repeat(64);

export type FixType = 'increase_gas' | 'set_eth_balance' | 'set_erc20_allowance';

export interface FixResult {
  wouldSucceed: boolean;
  gasUsed: number;
  revertReason?: string;
  fixDescription: string;
}

/**
 * Compute the storage slot for ERC20 _allowances[owner][spender].
 * OpenZeppelin ERC20 uses mappingSlot=1 (most common).
 * Some older or custom tokens use slot 0 or 2 — try others if slot 1 doesn't work.
 */
function erc20AllowanceSlot(owner: string, spender: string, mappingSlot = 1): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const innerHash = ethers.keccak256(coder.encode(['address', 'uint256'], [owner, mappingSlot]));
  return ethers.keccak256(coder.encode(['address', 'bytes32'], [spender, innerHash]));
}

function deepestRevertReason(callTrace: ReturnType<typeof normalizeCallTrace>): string | undefined {
  const stack = [callTrace];
  let deepest: string | undefined;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!node.success && node.revertReason) deepest = node.revertReason;
    stack.push(...node.children);
  }
  return deepest;
}

export async function simulateWithFix(
  txParams: RawTxParams,
  networkId: string,
  fix:
    | { type: 'increase_gas'; multiplier?: number }
    | { type: 'set_eth_balance'; amountEth?: number }
    | { type: 'set_erc20_allowance'; tokenAddress: string; spender: string; mappingSlot?: number },
): Promise<FixResult> {
  let gasOverride: number | null = null;
  let stateObjects: Record<string, unknown> = {};
  let fixDescription: string;

  switch (fix.type) {
    case 'increase_gas': {
      const mult = fix.multiplier ?? 2;
      gasOverride = Math.round(txParams.gas * mult);
      fixDescription = `Gas limit increased ${mult}x: ${txParams.gas.toLocaleString()} → ${gasOverride.toLocaleString()}`;
      break;
    }

    case 'set_eth_balance': {
      const eth = fix.amountEth ?? 100;
      const wei = BigInt(Math.round(eth * 1e18));
      stateObjects = {
        [txParams.from]: { balance: '0x' + wei.toString(16) },
      };
      fixDescription = `Sender ETH balance set to ${eth} ETH`;
      break;
    }

    case 'set_erc20_allowance': {
      const slot = erc20AllowanceSlot(txParams.from, fix.spender, fix.mappingSlot ?? 1);
      stateObjects = {
        [fix.tokenAddress]: { storage: { [slot]: MAX_UINT256 } },
      };
      fixDescription =
        `ERC20 allowance set to MaxUint256 — ` +
        `token: ${fix.tokenAddress}, owner: ${txParams.from.slice(0, 10)}..., spender: ${fix.spender.slice(0, 10)}...`;
      break;
    }
  }

  const simulation = await simulateWithOverrides(txParams, networkId, gasOverride, stateObjects);
  const tx = simulation.transaction;

  let revertReason: string | undefined;
  if (!tx.status) {
    const callTree = normalizeCallTrace(tx.transaction_info.call_trace);
    revertReason =
      deepestRevertReason(callTree) ??
      tx.error_info?.error_message ??
      'Unknown revert';
  }

  return {
    wouldSucceed: tx.status,
    gasUsed: tx.gas_used,
    revertReason,
    fixDescription,
  };
}
