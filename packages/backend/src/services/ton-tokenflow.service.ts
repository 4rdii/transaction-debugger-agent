import type { TokenFlow, TonTxData, TonTrace } from '@debugger/shared';
import { lookupTonContractName } from '../registry/ton-contracts.js';

const NANOTON = 1_000_000_000;

/** Resolve an address to a human-readable label */
function labelAddress(addr: string, accountNames: Map<string, string>): string {
  return lookupTonContractName(addr) ?? accountNames.get(addr) ?? addr;
}

// ─── From TonAPI event actions (preferred, pre-parsed) ──────────────────────

function extractFromEvent(txData: TonTxData): TokenFlow[] {
  const flows: TokenFlow[] = [];
  const names = txData.accountNames;

  // Jetton transfers
  for (const jt of txData.jettonTransfers) {
    const meta = txData.jettonMeta.get(jt.jettonMasterAddress);
    const decimals = jt.decimals ?? meta?.decimals ?? 9;
    const rawAmount = BigInt(jt.amount);
    const formatted = (Number(rawAmount) / Math.pow(10, decimals))
      .toFixed(decimals)
      .replace(/\.?0+$/, '');

    // Resolve token symbol: TonAPI symbol → registry → meta → fallback
    const tokenSymbol = jt.symbol
      ?? meta?.symbol
      ?? lookupTonContractName(jt.jettonMasterAddress)
      ?? jt.jettonMasterAddress.slice(0, 8) + '...';

    flows.push({
      type: 'Transfer',
      from: labelAddress(jt.senderAddress, names),
      to: labelAddress(jt.recipientAddress, names),
      tokenAddress: jt.jettonMasterAddress,
      tokenSymbol,
      tokenName: meta?.name ?? jt.symbol ?? lookupTonContractName(jt.jettonMasterAddress) ?? jt.jettonMasterAddress,
      decimals,
      rawAmount: jt.amount,
      formattedAmount: formatted,
    });
  }

  return flows;
}

// ─── From trace messages (fallback) ─────────────────────────────────────────

function extractNativeTonFlows(txData: TonTxData): TokenFlow[] {
  const flows: TokenFlow[] = [];
  const seen = new Set<string>();
  const names = txData.accountNames;

  function walkTrace(node: TonTrace) {
    const tx = node.transaction;
    const inMsg = tx.inMsg;

    if (inMsg && inMsg.source && inMsg.destination) {
      const value = BigInt(inMsg.value);
      if (value > 0n) {
        const key = `${inMsg.source}-${inMsg.destination}-${inMsg.value}-${inMsg.createdLt}`;
        if (!seen.has(key)) {
          seen.add(key);
          const formatted = (Number(value) / NANOTON).toFixed(9).replace(/\.?0+$/, '');
          flows.push({
            type: 'NativeTransfer',
            from: labelAddress(inMsg.source, names),
            to: labelAddress(inMsg.destination, names),
            tokenAddress: 'TON',
            tokenSymbol: 'TON',
            tokenName: 'Toncoin',
            decimals: 9,
            rawAmount: String(value),
            formattedAmount: formatted,
          });
        }
      }
    }

    for (const child of node.children) walkTrace(child);
  }

  walkTrace(txData.trace);
  return flows;
}

// ─── From TonAPI JettonSwap actions ─────────────────────────────────────────

function extractSwapFlows(txData: TonTxData): TokenFlow[] {
  const flows: TokenFlow[] = [];
  const names = txData.accountNames;

  for (const action of txData.eventActions ?? []) {
    if (action.type !== 'JettonSwap' || !action.swap || action.status === 'failed') continue;
    const s = action.swap;

    // Input token (sent to DEX)
    const fmtIn = (Number(BigInt(s.amountIn)) / Math.pow(10, s.decimalsIn ?? 9))
      .toFixed(Math.min(s.decimalsIn ?? 9, 6)).replace(/\.?0+$/, '');
    flows.push({
      type: 'SwapIn',
      from: labelAddress(txData.account, names),
      to: labelAddress(s.router, names),
      tokenAddress: s.tokenIn,
      tokenSymbol: s.symbolIn ?? 'unknown',
      tokenName: s.symbolIn ?? s.tokenIn,
      decimals: s.decimalsIn ?? 9,
      rawAmount: s.amountIn,
      formattedAmount: fmtIn,
    });

    // Output token (received from DEX)
    const fmtOut = (Number(BigInt(s.amountOut)) / Math.pow(10, s.decimalsOut ?? 9))
      .toFixed(Math.min(s.decimalsOut ?? 9, 6)).replace(/\.?0+$/, '');
    flows.push({
      type: 'SwapOut',
      from: labelAddress(s.router, names),
      to: labelAddress(txData.account, names),
      tokenAddress: s.tokenOut,
      tokenSymbol: s.symbolOut ?? 'unknown',
      tokenName: s.symbolOut ?? s.tokenOut,
      decimals: s.decimalsOut ?? 9,
      rawAmount: s.amountOut,
      formattedAmount: fmtOut,
    });
  }

  return flows;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function extractTonTokenFlows(txData: TonTxData): TokenFlow[] {
  const jettonFlows = extractFromEvent(txData);
  const swapFlows = extractSwapFlows(txData);
  const nativeFlows = extractNativeTonFlows(txData);
  return [...jettonFlows, ...swapFlows, ...nativeFlows];
}
