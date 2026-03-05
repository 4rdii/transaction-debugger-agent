import { describe, it, expect } from 'vitest';
import { detectSemanticActions } from '../services/action.service.js';
import type { NormalizedCall, TokenFlow, SemanticAction } from '@debugger/shared';

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

function makeTokenFlow(overrides: Partial<TokenFlow> = {}): TokenFlow {
  return {
    type: 'Transfer',
    from: '0xuser',
    to: '0xcontract',
    tokenAddress: '0xtoken1',
    tokenSymbol: 'USDC',
    tokenName: 'USD Coin',
    decimals: 6,
    rawAmount: '1000000',
    formattedAmount: '1.0',
    ...overrides,
  };
}

// ---------- tests ----------

describe('detectSemanticActions', () => {
  // ── Swap detection (known selector) ────────────────────────────────────

  it('detects Swap from Uniswap V2 swapExactTokensForTokens selector', () => {
    const call = makeCall({
      functionSelector: '0x38ed1739', // swapExactTokensForTokens
      functionName: 'swapExactTokensForTokens',
      protocol: 'Uniswap V2',
    });

    const flows = [
      makeTokenFlow({ tokenSymbol: 'WETH', tokenAddress: '0xweth' }),
      makeTokenFlow({ tokenSymbol: 'USDC', tokenAddress: '0xusdc' }),
    ];

    const actions = detectSemanticActions(call, flows);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Swap');
    expect(actions[0].protocol).toBe('Uniswap V2');
    expect(actions[0].involvedTokens).toContain('WETH');
    expect(actions[0].involvedTokens).toContain('USDC');
  });

  it('detects Swap from Uniswap V3 exactInputSingle selector', () => {
    const call = makeCall({
      functionSelector: '0x414bf389',
      protocol: 'Uniswap V3',
    });

    const flows = [makeTokenFlow({ tokenSymbol: 'DAI' })];
    const actions = detectSemanticActions(call, flows);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Swap');
    expect(actions[0].protocol).toBe('Uniswap V3');
  });

  it('detects Swap heuristically from AMM contract name with 2+ token transfers', () => {
    const call = makeCall({
      functionSelector: '0xdeadbeef', // not a known swap selector
      contractName: 'SushiSwapRouter',
      children: [
        makeCall({ id: 'call-1', depth: 1, caller: '0xuser', callee: '0xpair' }),
      ],
    });

    const flows = [
      makeTokenFlow({ type: 'Transfer', tokenAddress: '0xtokenA', tokenSymbol: 'TOKEN_A', from: '0xuser', to: '0xpair' }),
      makeTokenFlow({ type: 'Transfer', tokenAddress: '0xtokenB', tokenSymbol: 'TOKEN_B', from: '0xpair', to: '0xuser' }),
    ];

    const actions = detectSemanticActions(call, flows);

    expect(actions.some(a => a.type === 'Swap')).toBe(true);
  });

  // ── Approve detection ─────────────────────────────────────────────────

  it('detects Approve from ERC20 approve selector', () => {
    const call = makeCall({
      functionSelector: '0x095ea7b3',
      functionName: 'approve',
      decodedInputs: [
        { name: 'spender', type: 'address', value: '0xspender' },
        { name: 'amount', type: 'uint256', value: '1000000' },
      ],
    });

    const actions = detectSemanticActions(call, []);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Approve');
    expect(actions[0].protocol).toBe('ERC20');
    expect(actions[0].description).toContain('0xspender');
    expect(actions[0].involvedAddresses).toContain('0xspender');
  });

  // ── Flashloan detection ───────────────────────────────────────────────

  it('detects Flashloan from Aave V2 flashLoan selector', () => {
    const call = makeCall({
      functionSelector: '0xab9c4b5d',
      protocol: 'Aave V2',
      contractName: 'AaveLendingPool',
    });

    const actions = detectSemanticActions(call, []);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Flashloan');
    expect(actions[0].protocol).toBe('Aave V2');
  });

  it('detects Flashloan from Aave V3 flashLoanSimple selector', () => {
    const call = makeCall({
      functionSelector: '0x2dad97d4',
      protocol: 'Aave V3',
    });

    const actions = detectSemanticActions(call, []);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Flashloan');
  });

  it('detects Flashloan from Balancer flashLoan selector', () => {
    const call = makeCall({
      functionSelector: '0xb95cac28',
      protocol: 'Balancer',
    });

    const actions = detectSemanticActions(call, []);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Flashloan');
  });

  // ── Multicall detection ───────────────────────────────────────────────

  it('detects Multicall from Uniswap V3 multicall selector', () => {
    const call = makeCall({
      functionSelector: '0xac9650d8',
      protocol: 'Uniswap V3',
      children: [makeCall({ id: 'call-1' }), makeCall({ id: 'call-2' })],
    });

    const actions = detectSemanticActions(call, []);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Multicall');
    expect(actions[0].description).toContain('2 sub-calls');
  });

  it('detects Multicall from generic aggregate selector', () => {
    const call = makeCall({
      functionSelector: '0x252dba42',
      protocol: 'Multicall',
    });

    const actions = detectSemanticActions(call, []);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Multicall');
  });

  // ── Bridge detection ──────────────────────────────────────────────────

  it('detects Bridge from known bridge address', () => {
    const call = makeCall({
      callee: '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', // Optimism bridge
      functionName: 'depositETH',
      contractName: 'L1StandardBridge',
    });

    const actions = detectSemanticActions(call, []);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Bridge');
  });

  it('detects Bridge from contract name + function name heuristic', () => {
    const call = makeCall({
      callee: '0xunknownbridge',
      contractName: 'PolygonBridge',
      functionName: 'bridgeAsset',
    });

    const actions = detectSemanticActions(call, []);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Bridge');
  });

  // ── Liquidation detection ─────────────────────────────────────────────

  it('detects Liquidation from function name containing "liquidat"', () => {
    const call = makeCall({
      functionName: 'liquidateBorrow',
      functionSelector: '0xf5e3c462',
      contractName: 'cDAI',
    });

    const actions = detectSemanticActions(call, []);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Liquidation');
  });

  it('detects Liquidation from Aave V2 liquidationCall selector', () => {
    const call = makeCall({
      functionSelector: '0xdfd5281b',
      protocol: 'Aave V2',
    });

    const actions = detectSemanticActions(call, []);

    // Flashloan detection is tried first but 0xdfd5281b is not a flashloan selector,
    // so it falls through to liquidation
    expect(actions.some(a => a.type === 'Liquidation')).toBe(true);
  });

  // ── Deposit / Withdraw detection ──────────────────────────────────────

  it('detects Deposit on a lending protocol', () => {
    const call = makeCall({
      functionName: 'deposit',
      contractName: 'AaveLendingPool',
      protocol: 'Aave V2',
      functionSelector: '0xe8eda9df',
    });

    const flows = [makeTokenFlow({ tokenSymbol: 'USDC' })];
    const actions = detectSemanticActions(call, flows);

    expect(actions.some(a => a.type === 'Deposit')).toBe(true);
  });

  it('detects Withdraw on a lending protocol', () => {
    const call = makeCall({
      functionName: 'withdraw',
      contractName: 'CompoundPool',
      functionSelector: '0xaabbccdd',
    });

    const flows = [makeTokenFlow({ tokenSymbol: 'DAI' })];
    const actions = detectSemanticActions(call, flows);

    expect(actions.some(a => a.type === 'Withdraw')).toBe(true);
  });

  // ── Fallback Transfer action ──────────────────────────────────────────

  it('adds Transfer fallback when no high-level actions are detected', () => {
    const call = makeCall({
      functionSelector: '0xdeadbeef', // unknown selector
    });

    const flows = [
      makeTokenFlow({ tokenSymbol: 'USDC', type: 'Transfer' }),
      makeTokenFlow({ tokenSymbol: 'DAI', type: 'Transfer' }),
    ];

    const actions = detectSemanticActions(call, flows);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('Transfer');
    expect(actions[0].protocol).toBe('ERC20');
    expect(actions[0].involvedTokens).toContain('USDC');
    expect(actions[0].involvedTokens).toContain('DAI');
  });

  it('does NOT add Transfer fallback when high-level action is detected', () => {
    const call = makeCall({
      functionSelector: '0x38ed1739', // known swap
      protocol: 'Uniswap V2',
    });

    const flows = [makeTokenFlow({ type: 'Transfer', tokenSymbol: 'USDC' })];

    const actions = detectSemanticActions(call, flows);

    expect(actions.every(a => a.type !== 'Transfer')).toBe(true);
  });

  it('returns empty array when no actions and no transfers', () => {
    const call = makeCall({ functionSelector: '0xdeadbeef' });
    const actions = detectSemanticActions(call, []);
    expect(actions).toEqual([]);
  });

  // ── Multiple actions in one tree ──────────────────────────────────────

  it('detects multiple actions from a call tree with nested children', () => {
    const tree = makeCall({
      id: 'call-0',
      functionSelector: '0xab9c4b5d', // Aave flashloan
      protocol: 'Aave V2',
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          functionSelector: '0x38ed1739', // Uniswap V2 swap
          protocol: 'Uniswap V2',
        }),
        makeCall({
          id: 'call-2',
          depth: 1,
          functionSelector: '0x095ea7b3', // approve
          decodedInputs: [
            { name: 'spender', type: 'address', value: '0xrouter' },
            { name: 'amount', type: 'uint256', value: '1000' },
          ],
        }),
      ],
    });

    const flows = [
      makeTokenFlow({ tokenSymbol: 'WETH' }),
      makeTokenFlow({ tokenSymbol: 'USDC' }),
    ];

    const actions = detectSemanticActions(tree, flows);

    const types = actions.map(a => a.type);
    expect(types).toContain('Flashloan');
    expect(types).toContain('Swap');
    expect(types).toContain('Approve');
  });

  // ── getTokensInvolved (through Deposit/Withdraw) ─────────────────────

  it('getTokensInvolved returns tokens relevant to the call subtree addresses', () => {
    const call = makeCall({
      functionName: 'supply',
      contractName: 'AavePool',
      caller: '0xuser',
      callee: '0xpool',
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          caller: '0xpool',
          callee: '0xatoken',
        }),
      ],
    });

    const flows = [
      makeTokenFlow({ tokenSymbol: 'USDC', from: '0xuser', to: '0xpool' }),
      makeTokenFlow({ tokenSymbol: 'aUSDC', from: '0xpool', to: '0xuser' }),
      makeTokenFlow({ tokenSymbol: 'WETH', from: '0xother', to: '0xanother' }), // unrelated
    ];

    const actions = detectSemanticActions(call, flows);

    const deposit = actions.find(a => a.type === 'Deposit');
    expect(deposit).toBeDefined();
    expect(deposit!.involvedTokens).toContain('USDC');
    expect(deposit!.involvedTokens).toContain('aUSDC');
    // WETH is not in the call subtree addresses
    expect(deposit!.involvedTokens).not.toContain('WETH');
  });
});
