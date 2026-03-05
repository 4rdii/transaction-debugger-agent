import { describe, it, expect } from 'vitest';
import { extractSolanaTokenFlows } from '../services/solana-tokenflow.service.js';
import type { SolanaTxData, SolanaRawTransaction, HeliusEnrichedTransaction } from '@debugger/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBaseTxData(overrides: Partial<SolanaTxData> = {}): SolanaTxData {
  const raw: SolanaRawTransaction = {
    slot: 200_000_000,
    blockTime: 1700000000,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1_000_000_000, 500_000_000],
      postBalances: [999_995_000, 500_000_000],
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
      logMessages: [],
      computeUnitsConsumed: 50_000,
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: 'Payer11111111111111111111111111111111111111', signer: true, writable: true },
          { pubkey: 'Receiver111111111111111111111111111111111111', signer: false, writable: true },
        ],
        instructions: [],
      },
      signatures: ['sig123'],
    },
  };

  return {
    raw,
    enriched: null,
    signature: 'sig123',
    networkId: 'solana-mainnet',
    success: true,
    slot: 200_000_000,
    fee: 5000,
    computeUnitsConsumed: 50_000,
    feePayer: 'Payer11111111111111111111111111111111111111',
    accountKeys: ['Payer11111111111111111111111111111111111111', 'Receiver111111111111111111111111111111111111'],
    logMessages: [],
    ...overrides,
  };
}

// ─── Helius path tests ───────────────────────────────────────────────────────

describe('extractSolanaTokenFlows — Helius path', () => {
  it('extracts native SOL transfers from Helius enriched data', () => {
    const txData = makeBaseTxData({
      enriched: {
        signature: 'sig123',
        description: '',
        type: 'TRANSFER',
        source: '',
        fee: 5000,
        feePayer: 'Payer11111111111111111111111111111111111111',
        timestamp: 1700000000,
        nativeTransfers: [
          {
            fromUserAccount: 'Payer11111111111111111111111111111111111111',
            toUserAccount: 'Receiver111111111111111111111111111111111111',
            amount: 2_000_000_000, // 2 SOL
          },
        ],
        tokenTransfers: [],
        instructions: [],
        events: {},
      } as HeliusEnrichedTransaction,
    });

    const flows = extractSolanaTokenFlows(txData);

    expect(flows).toHaveLength(1);
    expect(flows[0].type).toBe('NativeTransfer');
    expect(flows[0].tokenSymbol).toBe('SOL');
    expect(flows[0].rawAmount).toBe('2000000000');
    expect(flows[0].formattedAmount).toBe('2');
    expect(flows[0].from).toBe('Payer11111111111111111111111111111111111111');
    expect(flows[0].to).toBe('Receiver111111111111111111111111111111111111');
  });

  it('extracts SPL token transfers from Helius enriched data', () => {
    const txData = makeBaseTxData({
      enriched: {
        signature: 'sig123',
        description: '',
        type: 'SWAP',
        source: 'JUPITER',
        fee: 5000,
        feePayer: 'Payer11111111111111111111111111111111111111',
        timestamp: 1700000000,
        nativeTransfers: [],
        tokenTransfers: [
          {
            fromUserAccount: 'Payer11111111111111111111111111111111111111',
            toUserAccount: 'Pool1111111111111111111111111111111111111111',
            fromTokenAccount: 'ataA',
            toTokenAccount: 'ataB',
            tokenAmount: 100.5,
            mint: 'USDCmint11111111111111111111111111111111111',
            tokenStandard: 'Fungible',
          },
        ],
        instructions: [],
        events: {},
      } as HeliusEnrichedTransaction,
    });

    const flows = extractSolanaTokenFlows(txData);

    expect(flows).toHaveLength(1);
    expect(flows[0].type).toBe('Transfer');
    expect(flows[0].tokenAddress).toBe('USDCmint11111111111111111111111111111111111');
    expect(flows[0].formattedAmount).toBe('100.5');
  });

  it('filters out zero-amount Helius transfers', () => {
    const txData = makeBaseTxData({
      enriched: {
        signature: 'sig123',
        description: '',
        type: 'TRANSFER',
        source: '',
        fee: 5000,
        feePayer: 'Payer',
        timestamp: 0,
        nativeTransfers: [
          { fromUserAccount: 'A', toUserAccount: 'B', amount: 0 },
        ],
        tokenTransfers: [
          { fromUserAccount: 'A', toUserAccount: 'B', fromTokenAccount: '', toTokenAccount: '', tokenAmount: 0, mint: 'M', tokenStandard: '' },
        ],
        instructions: [],
        events: {},
      } as HeliusEnrichedTransaction,
    });

    const flows = extractSolanaTokenFlows(txData);
    expect(flows).toHaveLength(0);
  });
});

// ─── RPC fallback path tests ─────────────────────────────────────────────────

describe('extractSolanaTokenFlows — RPC fallback', () => {
  it('extracts SPL token flows from pre/post token balance diffs', () => {
    const txData = makeBaseTxData();
    txData.raw.meta.preTokenBalances = [
      {
        accountIndex: 1,
        mint: 'USDCmint11111111111111111111111111111111111',
        owner: 'Payer11111111111111111111111111111111111111',
        uiTokenAmount: { amount: '1000000', decimals: 6, uiAmount: 1, uiAmountString: '1' },
      },
    ];
    txData.raw.meta.postTokenBalances = [
      {
        accountIndex: 1,
        mint: 'USDCmint11111111111111111111111111111111111',
        owner: 'Payer11111111111111111111111111111111111111',
        uiTokenAmount: { amount: '500000', decimals: 6, uiAmount: 0.5, uiAmountString: '0.5' },
      },
    ];

    const flows = extractSolanaTokenFlows(txData);

    // Payer lost 500000 units
    const outflow = flows.find(f => f.from === 'Payer11111111111111111111111111111111111111');
    expect(outflow).toBeDefined();
    expect(outflow!.rawAmount).toBe('500000');
    expect(outflow!.type).toBe('Transfer');
  });

  it('extracts native SOL flows from balance diffs (skipping fee payer debit)', () => {
    const txData = makeBaseTxData();
    // Account 0 (fee payer) loses 1 SOL + fee, account 1 gains 1 SOL
    txData.raw.meta.preBalances = [2_000_000_000, 0];
    txData.raw.meta.postBalances = [999_995_000, 1_000_000_000];

    const flows = extractSolanaTokenFlows(txData);

    // Should pick up the gain on account 1
    const gain = flows.find(f => f.to === 'Receiver111111111111111111111111111111111111');
    expect(gain).toBeDefined();
    expect(gain!.type).toBe('NativeTransfer');
    expect(gain!.tokenSymbol).toBe('SOL');
  });

  it('returns empty array when no balance changes', () => {
    const txData = makeBaseTxData();
    txData.raw.meta.preBalances = [1_000_000_000, 500_000_000];
    txData.raw.meta.postBalances = [1_000_000_000, 500_000_000];

    const flows = extractSolanaTokenFlows(txData);
    expect(flows).toHaveLength(0);
  });
});
