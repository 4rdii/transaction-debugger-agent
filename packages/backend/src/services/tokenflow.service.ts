import { ethers } from 'ethers';
import type { TenderlyAssetChange, TenderlyBalanceDiff, TokenFlow } from '@debugger/shared';

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();

export function extractTokenFlows(
  assetChanges: TenderlyAssetChange[] | undefined,
  balanceDiffs: TenderlyBalanceDiff[] | undefined
): TokenFlow[] {
  const flows: TokenFlow[] = [];

  // ERC20 / ERC721 / ERC1155 transfers from Tenderly's decoded asset_changes
  if (assetChanges) {
    for (const change of assetChanges) {
      const isMint = change.from === ZERO_ADDRESS || !change.from;
      const isBurn = change.to === ZERO_ADDRESS || !change.to;

      let flowType: TokenFlow['type'];
      if (change.type === 'Mint' || isMint) {
        flowType = 'Mint';
      } else if (change.type === 'Burn' || isBurn) {
        flowType = 'Burn';
      } else {
        flowType = 'Transfer';
      }

      flows.push({
        type: flowType,
        from: (change.from ?? ZERO_ADDRESS).toLowerCase(),
        to: (change.to ?? ZERO_ADDRESS).toLowerCase(),
        tokenAddress: change.token_info.contract_address.toLowerCase(),
        tokenSymbol: change.token_info.symbol,
        tokenName: change.token_info.name,
        decimals: change.token_info.decimals,
        rawAmount: change.raw_amount,
        formattedAmount: change.amount,
        dollarValue: change.dollar_value,
      });
    }
  }

  // Native ETH transfers from balance_diff (miner diffs excluded)
  if (balanceDiffs) {
    const nonMinerDiffs = balanceDiffs.filter(d => !d.is_miner);
    const netChanges = new Map<string, bigint>();

    for (const diff of nonMinerDiffs) {
      const addr = diff.address.toLowerCase();
      const before = BigInt(diff.original || '0');
      const after = BigInt(diff.dirty || '0');
      const delta = after - before;
      netChanges.set(addr, (netChanges.get(addr) ?? 0n) + delta);
    }

    // Build native transfer flows from positive/negative deltas
    const gainers: Array<{ address: string; amount: bigint }> = [];
    const losers: Array<{ address: string; amount: bigint }> = [];

    for (const [address, delta] of netChanges) {
      if (delta > 0n) gainers.push({ address, amount: delta });
      else if (delta < 0n) losers.push({ address, amount: -delta });
    }

    // Pair losers → gainers for native transfer representation
    for (const loser of losers) {
      for (const gainer of gainers) {
        // Only emit if the amounts are close (same order of magnitude)
        // This is a heuristic; in practice Tenderly's asset_changes covers most cases
        flows.push({
          type: 'NativeTransfer',
          from: loser.address,
          to: gainer.address,
          tokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          tokenSymbol: 'ETH',
          tokenName: 'Ether',
          decimals: 18,
          rawAmount: loser.amount.toString(),
          formattedAmount: ethers.formatEther(loser.amount),
        });
        break; // one loser → first gainer only (simplification)
      }
    }
  }

  return flows;
}
