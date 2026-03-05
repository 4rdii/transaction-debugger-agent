import { describe, it, expect } from 'vitest';
import { extractTokenFlows } from '../services/tokenflow.service.js';
import type { TenderlyAssetChange, TenderlyBalanceDiff, TokenFlow } from '@debugger/shared';

// ---------- helpers ----------

function makeAssetChange(overrides: Partial<TenderlyAssetChange> = {}): TenderlyAssetChange {
  return {
    token_info: {
      standard: 'ERC20',
      type: 'Fungible',
      contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    type: 'Transfer',
    from: '0xsender',
    to: '0xreceiver',
    amount: '1000.0',
    raw_amount: '1000000000',
    ...overrides,
  };
}

function makeBalanceDiff(overrides: Partial<TenderlyBalanceDiff> = {}): TenderlyBalanceDiff {
  return {
    address: '0xsomeaddress',
    is_miner: false,
    original: '1000000000000000000', // 1 ETH
    dirty: '2000000000000000000',    // 2 ETH
    ...overrides,
  };
}

// ---------- tests ----------

describe('extractTokenFlows', () => {
  // ── ERC20 transfers ───────────────────────────────────────────────────

  it('processes a basic ERC20 Transfer from asset_changes', () => {
    const changes = [makeAssetChange()];
    const flows = extractTokenFlows(changes, undefined);

    expect(flows).toHaveLength(1);
    expect(flows[0].type).toBe('Transfer');
    expect(flows[0].from).toBe('0xsender');
    expect(flows[0].to).toBe('0xreceiver');
    expect(flows[0].tokenSymbol).toBe('USDC');
    expect(flows[0].tokenName).toBe('USD Coin');
    expect(flows[0].decimals).toBe(6);
    expect(flows[0].rawAmount).toBe('1000000000');
    expect(flows[0].formattedAmount).toBe('1000.0');
  });

  it('lowercases token address, from, and to', () => {
    const changes = [
      makeAssetChange({
        token_info: {
          standard: 'ERC20',
          type: 'Fungible',
          contract_address: '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
        },
        from: '0xABCDEF',
        to: '0x123ABC',
      }),
    ];

    const flows = extractTokenFlows(changes, undefined);

    expect(flows[0].tokenAddress).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(flows[0].from).toBe('0xabcdef');
    expect(flows[0].to).toBe('0x123abc');
  });

  it('preserves dollarValue when present', () => {
    const changes = [
      makeAssetChange({ dollar_value: '$1,500.00' }),
    ];

    const flows = extractTokenFlows(changes, undefined);
    expect(flows[0].dollarValue).toBe('$1,500.00');
  });

  it('handles multiple ERC20 transfers', () => {
    const changes = [
      makeAssetChange({ token_info: { standard: 'ERC20', type: 'Fungible', contract_address: '0xtoken1', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 } }),
      makeAssetChange({ token_info: { standard: 'ERC20', type: 'Fungible', contract_address: '0xtoken2', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 } }),
    ];

    const flows = extractTokenFlows(changes, undefined);

    expect(flows).toHaveLength(2);
    expect(flows[0].tokenSymbol).toBe('WETH');
    expect(flows[1].tokenSymbol).toBe('DAI');
  });

  // ── Mint / Burn detection ─────────────────────────────────────────────

  it('detects Mint when type is "Mint"', () => {
    const changes = [
      makeAssetChange({ type: 'Mint', from: '0x0000000000000000000000000000000000000000' }),
    ];

    const flows = extractTokenFlows(changes, undefined);
    expect(flows[0].type).toBe('Mint');
  });

  it('detects Mint when from is the zero address', () => {
    const changes = [
      makeAssetChange({ type: 'Transfer', from: '0x0000000000000000000000000000000000000000' }),
    ];

    const flows = extractTokenFlows(changes, undefined);
    expect(flows[0].type).toBe('Mint');
  });

  it('detects Mint when from is missing (undefined)', () => {
    const change = makeAssetChange();
    // @ts-expect-error — simulate missing 'from'
    delete change.from;

    const flows = extractTokenFlows([change], undefined);
    expect(flows[0].type).toBe('Mint');
    expect(flows[0].from).toBe('0x0000000000000000000000000000000000000000');
  });

  it('detects Burn when type is "Burn"', () => {
    const changes = [
      makeAssetChange({ type: 'Burn', to: '0x0000000000000000000000000000000000000000' }),
    ];

    const flows = extractTokenFlows(changes, undefined);
    expect(flows[0].type).toBe('Burn');
  });

  it('detects Burn when to is the zero address', () => {
    const changes = [
      makeAssetChange({ type: 'Transfer', to: '0x0000000000000000000000000000000000000000' }),
    ];

    const flows = extractTokenFlows(changes, undefined);
    expect(flows[0].type).toBe('Burn');
  });

  // ── Native ETH flows from balance_diff ────────────────────────────────

  it('extracts NativeTransfer from balance_diff', () => {
    const diffs = [
      makeBalanceDiff({
        address: '0xsender',
        original: '10000000000000000000', // 10 ETH
        dirty: '8000000000000000000',     // 8 ETH (lost 2 ETH)
      }),
      makeBalanceDiff({
        address: '0xreceiver',
        original: '1000000000000000000', // 1 ETH
        dirty: '3000000000000000000',    // 3 ETH (gained 2 ETH)
      }),
    ];

    const flows = extractTokenFlows(undefined, diffs);

    const nativeFlows = flows.filter(f => f.type === 'NativeTransfer');
    expect(nativeFlows).toHaveLength(1);
    expect(nativeFlows[0].from).toBe('0xsender');
    expect(nativeFlows[0].to).toBe('0xreceiver');
    expect(nativeFlows[0].tokenSymbol).toBe('ETH');
    expect(nativeFlows[0].tokenName).toBe('Ether');
    expect(nativeFlows[0].decimals).toBe(18);
    expect(nativeFlows[0].tokenAddress).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  });

  it('lowercases addresses in balance_diff flows', () => {
    const diffs = [
      makeBalanceDiff({ address: '0xSENDER', original: '10000000000000000000', dirty: '8000000000000000000' }),
      makeBalanceDiff({ address: '0xRECEIVER', original: '1000000000000000000', dirty: '3000000000000000000' }),
    ];

    const flows = extractTokenFlows(undefined, diffs);
    const native = flows.find(f => f.type === 'NativeTransfer');

    expect(native!.from).toBe('0xsender');
    expect(native!.to).toBe('0xreceiver');
  });

  it('excludes miner balance diffs', () => {
    const diffs = [
      makeBalanceDiff({ address: '0xminer', is_miner: true, original: '0', dirty: '5000000000000000000' }),
      makeBalanceDiff({ address: '0xsender', original: '10000000000000000000', dirty: '5000000000000000000' }),
    ];

    const flows = extractTokenFlows(undefined, diffs);

    // The miner gained ETH but should be filtered out.
    // Without a valid gainer (miner is excluded), the loser has no one to pair with.
    // Actually the miner is excluded from netChanges, so only 0xsender is a loser with no gainer.
    const nativeFlows = flows.filter(f => f.type === 'NativeTransfer');
    expect(nativeFlows).toHaveLength(0);
  });

  it('handles balance_diff with zero change (no native flow)', () => {
    const diffs = [
      makeBalanceDiff({ address: '0xnoop', original: '1000', dirty: '1000' }),
    ];

    const flows = extractTokenFlows(undefined, diffs);
    expect(flows.filter(f => f.type === 'NativeTransfer')).toHaveLength(0);
  });

  // ── Combined asset_changes + balance_diff ─────────────────────────────

  it('combines ERC20 and native flows', () => {
    const changes = [makeAssetChange()];
    const diffs = [
      makeBalanceDiff({ address: '0xsender', original: '10000000000000000000', dirty: '8000000000000000000' }),
      makeBalanceDiff({ address: '0xreceiver', original: '0', dirty: '2000000000000000000' }),
    ];

    const flows = extractTokenFlows(changes, diffs);

    const erc20 = flows.filter(f => f.type === 'Transfer');
    const native = flows.filter(f => f.type === 'NativeTransfer');

    expect(erc20).toHaveLength(1);
    expect(native).toHaveLength(1);
  });

  // ── Empty / undefined inputs ──────────────────────────────────────────

  it('returns empty array when both inputs are undefined', () => {
    const flows = extractTokenFlows(undefined, undefined);
    expect(flows).toEqual([]);
  });

  it('returns empty array when asset_changes is empty and no balance_diff', () => {
    const flows = extractTokenFlows([], undefined);
    expect(flows).toEqual([]);
  });

  it('returns empty array when balance_diff is empty and no asset_changes', () => {
    const flows = extractTokenFlows(undefined, []);
    expect(flows).toEqual([]);
  });

  it('returns empty array when both inputs are empty arrays', () => {
    const flows = extractTokenFlows([], []);
    expect(flows).toEqual([]);
  });

  // ── rawAmount is used for NativeTransfer ──────────────────────────────

  it('uses loser amount as rawAmount for NativeTransfer', () => {
    const diffs = [
      makeBalanceDiff({ address: '0xfrom', original: '5000000000000000000', dirty: '3000000000000000000' }),
      makeBalanceDiff({ address: '0xto', original: '0', dirty: '2000000000000000000' }),
    ];

    const flows = extractTokenFlows(undefined, diffs);
    const native = flows.find(f => f.type === 'NativeTransfer');

    // loser amount = 5e18 - 3e18 = 2e18
    expect(native!.rawAmount).toBe('2000000000000000000');
    expect(native!.formattedAmount).toBe('2.0');
  });
});
