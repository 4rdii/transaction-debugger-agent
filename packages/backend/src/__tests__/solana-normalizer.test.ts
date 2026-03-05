import { describe, it, expect } from 'vitest';
import { normalizeSolanaTransaction } from '../services/solana-normalizer.service.js';
import type { SolanaTxData, SolanaRawTransaction } from '@debugger/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTxData(overrides: Partial<SolanaTxData> = {}): SolanaTxData {
  const raw: SolanaRawTransaction = {
    slot: 200_000_000,
    blockTime: 1700000000,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1000000000, 500000000],
      postBalances: [999995000, 500000000],
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
      logMessages: [],
      computeUnitsConsumed: 50_000,
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: 'FeePayer111111111111111111111111111111111111', signer: true, writable: true },
          { pubkey: 'Program11111111111111111111111111111111111111', signer: false, writable: false },
        ],
        instructions: [
          {
            programId: '11111111111111111111111111111111',
            parsed: { type: 'transfer', info: { source: 'A', destination: 'B', lamports: 1000 } },
          },
        ],
      },
      signatures: ['5abc123def'],
    },
  };

  return {
    raw,
    enriched: null,
    signature: '5abc123def',
    networkId: 'solana-mainnet',
    success: true,
    slot: 200_000_000,
    fee: 5000,
    computeUnitsConsumed: 50_000,
    feePayer: 'FeePayer111111111111111111111111111111111111',
    accountKeys: ['FeePayer111111111111111111111111111111111111', 'Program11111111111111111111111111111111111111'],
    logMessages: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('normalizeSolanaTransaction', () => {
  it('creates a root node with correct metadata', () => {
    const txData = makeTxData();
    const root = normalizeSolanaTransaction(txData);

    expect(root.id).toBe('call-0');
    expect(root.depth).toBe(0);
    expect(root.callType).toBe('INVOKE');
    expect(root.caller).toBe('FeePayer111111111111111111111111111111111111');
    expect(root.gasUsed).toBe(50_000);
    expect(root.success).toBe(true);
    expect(root.functionName).toBe('transaction');
  });

  it('creates children for top-level instructions', () => {
    const txData = makeTxData();
    const root = normalizeSolanaTransaction(txData);

    expect(root.children).toHaveLength(1);
    expect(root.children[0].id).toBe('call-1');
    expect(root.children[0].depth).toBe(1);
    expect(root.children[0].callType).toBe('INVOKE');
    expect(root.children[0].callee).toBe('11111111111111111111111111111111');
    expect(root.children[0].contractName).toBe('System Program');
  });

  it('resolves known program names', () => {
    const txData = makeTxData();
    txData.raw.transaction.message.instructions = [
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'transfer', info: {} } },
    ];
    const root = normalizeSolanaTransaction(txData);

    expect(root.children[0].contractName).toBe('SPL Token');
    expect(root.children[0].protocol).toBe('SPL Token');
  });

  it('extracts function name from parsed instruction type', () => {
    const txData = makeTxData();
    const root = normalizeSolanaTransaction(txData);

    expect(root.children[0].functionName).toBe('transfer');
  });

  it('handles multiple instructions', () => {
    const txData = makeTxData();
    txData.raw.transaction.message.instructions = [
      { programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: {} } },
      { programId: 'ComputeBudget111111111111111111111111111111', parsed: { type: 'setComputeUnitLimit', info: {} } },
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'transferChecked', info: {} } },
    ];
    const root = normalizeSolanaTransaction(txData);

    expect(root.children).toHaveLength(3);
    expect(root.children[0].id).toBe('call-1');
    expect(root.children[1].id).toBe('call-2');
    expect(root.children[2].id).toBe('call-3');
  });

  it('adds inner instructions (CPIs) as children', () => {
    const txData = makeTxData();
    txData.raw.meta.innerInstructions = [
      {
        index: 0, // inner instructions for the first top-level instruction
        instructions: [
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'transfer', info: {} } },
          { programId: '11111111111111111111111111111111', parsed: { type: 'createAccount', info: {} } },
        ],
      },
    ];
    const root = normalizeSolanaTransaction(txData);

    expect(root.children[0].children).toHaveLength(2);
    expect(root.children[0].children[0].callType).toBe('CPI');
    expect(root.children[0].children[0].contractName).toBe('SPL Token');
    expect(root.children[0].children[0].functionName).toBe('transfer');
    expect(root.children[0].children[1].callType).toBe('CPI');
    expect(root.children[0].children[1].contractName).toBe('System Program');
  });

  it('marks failed transactions correctly', () => {
    const txData = makeTxData({
      success: false,
    });
    txData.raw.meta.err = { InstructionError: [0, 'Custom'] };
    const root = normalizeSolanaTransaction(txData);

    expect(root.success).toBe(false);
    expect(root.revertReason).toBe('{"InstructionError":[0,"Custom"]}');
  });

  it('extracts error reason from log messages', () => {
    const txData = makeTxData({
      success: true,
      logMessages: [
        'Program 11111111111111111111111111111111 invoke [1]',
        'Program 11111111111111111111111111111111 failed: insufficient funds',
      ],
    });
    const root = normalizeSolanaTransaction(txData);

    // The error should be on the child instruction that invoked the failing program
    expect(root.children[0].success).toBe(false);
    expect(root.children[0].revertReason).toBe('insufficient funds');
  });

  it('produces independent ID sequences for separate calls', () => {
    const txDataA = makeTxData();
    const txDataB = makeTxData();
    txDataB.raw.transaction.message.instructions = [
      { programId: '11111111111111111111111111111111', parsed: { type: 'a', info: {} } },
      { programId: '11111111111111111111111111111111', parsed: { type: 'b', info: {} } },
    ];

    const rootA = normalizeSolanaTransaction(txDataA);
    const rootB = normalizeSolanaTransaction(txDataB);

    // Both start at call-0
    expect(rootA.id).toBe('call-0');
    expect(rootB.id).toBe('call-0');
    expect(rootA.children[0].id).toBe('call-1');
    expect(rootB.children[0].id).toBe('call-1');
    expect(rootB.children[1].id).toBe('call-2');
  });
});
