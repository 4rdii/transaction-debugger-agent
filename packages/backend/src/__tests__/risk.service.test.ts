import { describe, it, expect } from 'vitest';
import { detectRisks } from '../services/risk.service.js';
import type { NormalizedCall, TokenFlow, SemanticAction, RiskFlag } from '@debugger/shared';

// ---------- helpers ----------

function makeCall(overrides: Partial<NormalizedCall> = {}): NormalizedCall {
  return {
    id: 'call-0',
    depth: 0,
    callType: 'CALL',
    caller: '0xuser',
    callee: '0xcontract',
    decodedInputs: [],
    decodedOutputs: [],
    gasUsed: 50_000,
    valueWei: '0x0',
    success: true,
    children: [],
    ...overrides,
  };
}

function makeFlow(overrides: Partial<TokenFlow> = {}): TokenFlow {
  return {
    type: 'Transfer',
    from: '0xfrom',
    to: '0xto',
    tokenAddress: '0xtoken',
    tokenSymbol: 'USDC',
    tokenName: 'USD Coin',
    decimals: 6,
    rawAmount: '1000000',
    formattedAmount: '1.0',
    ...overrides,
  };
}

function makeAction(overrides: Partial<SemanticAction> = {}): SemanticAction {
  return {
    type: 'Swap',
    callId: 'call-0',
    description: 'test action',
    involvedTokens: [],
    involvedAddresses: [],
    ...overrides,
  };
}

const MAX_UINT256 = (2n ** 256n - 1n).toString();

// ---------- tests ----------

describe('detectRisks', () => {
  // ── Unlimited approvals ───────────────────────────────────────────────

  it('flags unlimited approval (MaxUint256 numeric string)', () => {
    const tree = makeCall({
      functionSelector: '0x095ea7b3', // approve(address,uint256)
      callee: '0xspender',
      decodedInputs: [
        { name: 'spender', type: 'address', value: '0xspender' },
        { name: 'amount', type: 'uint256', value: MAX_UINT256 },
      ],
    });

    const risks = detectRisks(tree, [], []);

    const approvalRisks = risks.filter(r => r.type === 'UNLIMITED_APPROVAL');
    expect(approvalRisks).toHaveLength(1);
    expect(approvalRisks[0].level).toBe('medium');
    expect(approvalRisks[0].description).toContain('Unlimited ERC20 approval');
    expect(approvalRisks[0].callId).toBe('call-0');
  });

  it('flags unlimited approval when value is "MaxUint256" string', () => {
    const tree = makeCall({
      functionSelector: '0x095ea7b3',
      decodedInputs: [
        { name: 'spender', type: 'address', value: '0xspender' },
        { name: 'value', type: 'uint256', value: 'MaxUint256' },
      ],
    });

    const risks = detectRisks(tree, [], []);
    expect(risks.some(r => r.type === 'UNLIMITED_APPROVAL')).toBe(true);
  });

  it('does NOT flag approval with a finite amount', () => {
    const tree = makeCall({
      functionSelector: '0x095ea7b3',
      decodedInputs: [
        { name: 'spender', type: 'address', value: '0xspender' },
        { name: 'amount', type: 'uint256', value: '1000000' },
      ],
    });

    const risks = detectRisks(tree, [], []);
    expect(risks.some(r => r.type === 'UNLIMITED_APPROVAL')).toBe(false);
  });

  it('does NOT flag non-approve selectors even with MaxUint256', () => {
    const tree = makeCall({
      functionSelector: '0xa9059cbb', // transfer, not approve
      decodedInputs: [
        { name: 'amount', type: 'uint256', value: MAX_UINT256 },
      ],
    });

    const risks = detectRisks(tree, [], []);
    expect(risks.some(r => r.type === 'UNLIMITED_APPROVAL')).toBe(false);
  });

  it('finds unlimited approval in nested children', () => {
    const tree = makeCall({
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          functionSelector: '0x095ea7b3',
          callee: '0xrouter',
          decodedInputs: [
            { name: 'spender', type: 'address', value: '0xrouter' },
            { name: '_value', type: 'uint256', value: MAX_UINT256 },
          ],
        }),
      ],
    });

    const risks = detectRisks(tree, [], []);
    const approvalRisks = risks.filter(r => r.type === 'UNLIMITED_APPROVAL');
    expect(approvalRisks).toHaveLength(1);
    expect(approvalRisks[0].callId).toBe('call-1');
  });

  // ── Flashloan usage ───────────────────────────────────────────────────

  it('flags flashloan usage from semantic actions', () => {
    const tree = makeCall();
    const actions = [
      makeAction({ type: 'Flashloan', protocol: 'Aave V2', callId: 'call-0' }),
    ];

    const risks = detectRisks(tree, [], actions);

    const flashRisks = risks.filter(r => r.type === 'FLASHLOAN_USAGE');
    expect(flashRisks).toHaveLength(1);
    expect(flashRisks[0].level).toBe('medium');
    expect(flashRisks[0].description).toContain('Aave V2');
  });

  it('does NOT flag flashloan when no flashloan actions present', () => {
    const tree = makeCall();
    const actions = [makeAction({ type: 'Swap' })];

    const risks = detectRisks(tree, [], actions);
    expect(risks.some(r => r.type === 'FLASHLOAN_USAGE')).toBe(false);
  });

  // ── Large value transfers ─────────────────────────────────────────────

  it('flags large ETH transfer (>= 10 ETH)', () => {
    const tree = makeCall();
    const flows = [
      makeFlow({
        type: 'NativeTransfer',
        tokenSymbol: 'ETH',
        rawAmount: '15000000000000000000', // 15 ETH in wei
        formattedAmount: '15.0',
      }),
    ];

    const risks = detectRisks(tree, flows, []);

    const largeEth = risks.filter(r => r.type === 'LARGE_ETH_TRANSFER');
    expect(largeEth).toHaveLength(1);
    expect(largeEth[0].level).toBe('medium');
    expect(largeEth[0].description).toContain('15.0 ETH');
  });

  it('does NOT flag small ETH transfer (< 10 ETH)', () => {
    const tree = makeCall();
    const flows = [
      makeFlow({
        type: 'NativeTransfer',
        tokenSymbol: 'ETH',
        rawAmount: '1000000000000000000', // 1 ETH
        formattedAmount: '1.0',
      }),
    ];

    const risks = detectRisks(tree, flows, []);
    expect(risks.some(r => r.type === 'LARGE_ETH_TRANSFER')).toBe(false);
  });

  it('flags large token transfer by dollar value (>= $50k)', () => {
    const tree = makeCall();
    const flows = [
      makeFlow({
        type: 'Transfer',
        tokenSymbol: 'USDC',
        rawAmount: '100000000000', // 100k USDC
        formattedAmount: '100000.0',
        dollarValue: '$100,000.00',
      }),
    ];

    const risks = detectRisks(tree, flows, []);

    const largeTx = risks.filter(r => r.type === 'LARGE_TOKEN_TRANSFER');
    expect(largeTx).toHaveLength(1);
    expect(largeTx[0].level).toBe('medium');
  });

  it('does NOT flag token transfer under $50k', () => {
    const tree = makeCall();
    const flows = [
      makeFlow({
        type: 'Transfer',
        dollarValue: '$10,000.00',
      }),
    ];

    const risks = detectRisks(tree, flows, []);
    expect(risks.some(r => r.type === 'LARGE_TOKEN_TRANSFER')).toBe(false);
  });

  it('handles malformed rawAmount gracefully for NativeTransfer', () => {
    const tree = makeCall();
    const flows = [
      makeFlow({
        type: 'NativeTransfer',
        rawAmount: 'not-a-number',
      }),
    ];

    // Should not throw
    const risks = detectRisks(tree, flows, []);
    expect(risks.some(r => r.type === 'LARGE_ETH_TRANSFER')).toBe(false);
  });

  // ── DELEGATECALL to unknown contracts ─────────────────────────────────

  it('flags DELEGATECALL to unknown (unlabeled) contract', () => {
    const tree = makeCall({
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          callType: 'DELEGATECALL',
          callee: '0xunknown',
          // no contractName — unknown
        }),
      ],
    });

    const risks = detectRisks(tree, [], []);

    const dcRisks = risks.filter(r => r.type === 'DELEGATECALL_TO_UNKNOWN');
    expect(dcRisks).toHaveLength(1);
    expect(dcRisks[0].level).toBe('high');
    expect(dcRisks[0].description).toContain('0xunknown');
    expect(dcRisks[0].callId).toBe('call-1');
  });

  it('does NOT flag DELEGATECALL to known (named) contract', () => {
    const tree = makeCall({
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          callType: 'DELEGATECALL',
          callee: '0ximplementation',
          contractName: 'ImplementationV2',
        }),
      ],
    });

    const risks = detectRisks(tree, [], []);
    expect(risks.some(r => r.type === 'DELEGATECALL_TO_UNKNOWN')).toBe(false);
  });

  it('does NOT flag regular CALL to unknown contract as DELEGATECALL risk', () => {
    const tree = makeCall({
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          callType: 'CALL',
          callee: '0xunknown',
          // no contractName
        }),
      ],
    });

    const risks = detectRisks(tree, [], []);
    expect(risks.some(r => r.type === 'DELEGATECALL_TO_UNKNOWN')).toBe(false);
  });

  // ── Unverified top-level contract ─────────────────────────────────────

  it('flags unverified top-level contract', () => {
    const tree = makeCall({
      callee: '0xunverified',
      // no contractName at depth 0
    });

    const risks = detectRisks(tree, [], []);

    const unverifiedRisks = risks.filter(r => r.type === 'UNVERIFIED_CONTRACT');
    expect(unverifiedRisks).toHaveLength(1);
    expect(unverifiedRisks[0].level).toBe('low');
  });

  it('does NOT flag verified top-level contract', () => {
    const tree = makeCall({
      contractName: 'UniswapV3Router',
    });

    const risks = detectRisks(tree, [], []);
    expect(risks.some(r => r.type === 'UNVERIFIED_CONTRACT')).toBe(false);
  });

  // ── Multiple risks combined ───────────────────────────────────────────

  it('returns multiple risk types from a single analysis', () => {
    const tree = makeCall({
      // unverified top-level
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          functionSelector: '0x095ea7b3',
          callee: '0xspender',
          decodedInputs: [
            { name: 'amount', type: 'uint256', value: MAX_UINT256 },
          ],
        }),
        makeCall({
          id: 'call-2',
          depth: 1,
          callType: 'DELEGATECALL',
          callee: '0xshadycontract',
        }),
      ],
    });

    const flows = [
      makeFlow({
        type: 'NativeTransfer',
        rawAmount: '50000000000000000000', // 50 ETH
        formattedAmount: '50.0',
        from: '0xuser',
        to: '0xsomewhere',
      }),
    ];

    const actions = [
      makeAction({ type: 'Flashloan', protocol: 'Balancer' }),
    ];

    const risks = detectRisks(tree, flows, actions);
    const types = risks.map(r => r.type);

    expect(types).toContain('UNLIMITED_APPROVAL');
    expect(types).toContain('FLASHLOAN_USAGE');
    expect(types).toContain('LARGE_ETH_TRANSFER');
    expect(types).toContain('DELEGATECALL_TO_UNKNOWN');
    expect(types).toContain('UNVERIFIED_CONTRACT');
  });

  // ── No risks at all ───────────────────────────────────────────────────

  it('returns empty array when no risks are detected', () => {
    const tree = makeCall({ contractName: 'SafeContract' });
    const flows = [makeFlow({ type: 'Transfer', rawAmount: '1000', dollarValue: '$1.00' })];
    const actions = [makeAction({ type: 'Swap' })];

    const risks = detectRisks(tree, flows, actions);

    // The only possible flag would be UNVERIFIED_CONTRACT but we set contractName
    // No unlimited approvals, no flashloans, no large transfers, no delegatecalls
    expect(risks).toEqual([]);
  });
});
