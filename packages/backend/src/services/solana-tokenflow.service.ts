import type { TokenFlow, SolanaTxData } from '@debugger/shared';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

// ─── Helius-enriched path ────────────────────────────────────────────────────

function extractFromHelius(txData: SolanaTxData): TokenFlow[] {
  const enriched = txData.enriched;
  if (!enriched) return [];

  const flows: TokenFlow[] = [];

  // Native SOL transfers
  for (const nt of enriched.nativeTransfers) {
    if (nt.amount === 0) continue;
    flows.push({
      type: 'NativeTransfer',
      from: nt.fromUserAccount,
      to: nt.toUserAccount,
      tokenAddress: SOL_MINT,
      tokenSymbol: 'SOL',
      tokenName: 'Solana',
      decimals: 9,
      rawAmount: String(nt.amount),
      formattedAmount: (nt.amount / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, ''),
    });
  }

  // SPL token transfers
  for (const tt of enriched.tokenTransfers) {
    if (tt.tokenAmount === 0) continue;
    flows.push({
      type: 'Transfer',
      from: tt.fromUserAccount,
      to: tt.toUserAccount,
      tokenAddress: tt.mint,
      tokenSymbol: tt.mint.slice(0, 6) + '...',
      tokenName: tt.mint,
      decimals: 0, // Helius provides pre-formatted amounts
      rawAmount: String(tt.tokenAmount),
      formattedAmount: String(tt.tokenAmount),
    });
  }

  return flows;
}

// ─── RPC fallback path ───────────────────────────────────────────────────────

function extractFromRpc(txData: SolanaTxData): TokenFlow[] {
  const { raw } = txData;
  const flows: TokenFlow[] = [];
  const accountKeys = txData.accountKeys;

  // SPL token flows: diff pre vs post token balances
  const preMap = new Map<string, { mint: string; owner: string; amount: bigint; decimals: number }>();
  for (const tb of raw.meta.preTokenBalances) {
    const key = `${tb.mint}-${tb.owner}`;
    preMap.set(key, {
      mint: tb.mint,
      owner: tb.owner,
      amount: BigInt(tb.uiTokenAmount.amount),
      decimals: tb.uiTokenAmount.decimals,
    });
  }

  for (const tb of raw.meta.postTokenBalances) {
    const key = `${tb.mint}-${tb.owner}`;
    const pre = preMap.get(key);
    const preAmount = pre?.amount ?? 0n;
    const postAmount = BigInt(tb.uiTokenAmount.amount);
    const delta = postAmount - preAmount;

    if (delta === 0n) continue;

    // Positive delta means this account received tokens
    // We can't determine exact from/to pairs from diffs, so we use the owner as both
    const decimals = tb.uiTokenAmount.decimals;
    const formatted = tb.uiTokenAmount.uiAmountString ?? String(Number(delta) / Math.pow(10, decimals));

    if (delta > 0n) {
      flows.push({
        type: 'Transfer',
        from: 'unknown',
        to: tb.owner,
        tokenAddress: tb.mint,
        tokenSymbol: tb.mint.slice(0, 6) + '...',
        tokenName: tb.mint,
        decimals,
        rawAmount: delta.toString(),
        formattedAmount: formatted,
      });
    } else {
      flows.push({
        type: 'Transfer',
        from: tb.owner,
        to: 'unknown',
        tokenAddress: tb.mint,
        tokenSymbol: tb.mint.slice(0, 6) + '...',
        tokenName: tb.mint,
        decimals,
        rawAmount: (-delta).toString(),
        formattedAmount: formatted.replace('-', ''),
      });
    }

    // Remove from preMap so we can detect accounts that only had pre-balances
    preMap.delete(key);
  }

  // Accounts that had preBalances but no postBalances (fully drained)
  for (const [, pre] of preMap) {
    if (pre.amount === 0n) continue;
    flows.push({
      type: 'Transfer',
      from: pre.owner,
      to: 'unknown',
      tokenAddress: pre.mint,
      tokenSymbol: pre.mint.slice(0, 6) + '...',
      tokenName: pre.mint,
      decimals: pre.decimals,
      rawAmount: pre.amount.toString(),
      formattedAmount: String(Number(pre.amount) / Math.pow(10, pre.decimals)),
    });
  }

  // Native SOL flows from balance diffs
  for (let i = 0; i < accountKeys.length; i++) {
    const pre = raw.meta.preBalances[i] ?? 0;
    const post = raw.meta.postBalances[i] ?? 0;
    const delta = post - pre;

    // Skip tiny diffs (rent/fees) and zero diffs
    if (Math.abs(delta) < 5000) continue;

    // Skip the fee payer's debit (it's just the tx fee)
    if (i === 0 && delta < 0) continue;

    if (delta > 0) {
      flows.push({
        type: 'NativeTransfer',
        from: 'unknown',
        to: accountKeys[i],
        tokenAddress: SOL_MINT,
        tokenSymbol: 'SOL',
        tokenName: 'Solana',
        decimals: 9,
        rawAmount: String(delta),
        formattedAmount: (delta / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, ''),
      });
    } else if (delta < 0) {
      flows.push({
        type: 'NativeTransfer',
        from: accountKeys[i],
        to: 'unknown',
        tokenAddress: SOL_MINT,
        tokenSymbol: 'SOL',
        tokenName: 'Solana',
        decimals: 9,
        rawAmount: String(-delta),
        formattedAmount: (-delta / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, ''),
      });
    }
  }

  return flows;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function extractSolanaTokenFlows(txData: SolanaTxData): TokenFlow[] {
  // Prefer Helius enriched data when available
  if (txData.enriched) {
    const flows = extractFromHelius(txData);
    if (flows.length > 0) return flows;
  }

  return extractFromRpc(txData);
}
