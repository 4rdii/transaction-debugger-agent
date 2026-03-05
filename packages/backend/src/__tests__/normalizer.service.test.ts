import { describe, it, expect } from 'vitest';
import { normalizeCallTrace } from '../services/normalizer.service.js';
import type { TenderlyCallTrace, NormalizedCall } from '@debugger/shared';

// ---------- helpers ----------

function makeTrace(overrides: Partial<TenderlyCallTrace> = {}): TenderlyCallTrace {
  return {
    type: 'CALL',
    from: '0xABC',
    to: '0xDEF',
    input: '0x',
    gas: 100_000,
    gas_used: 50_000,
    ...overrides,
  };
}

// ---------- tests ----------

describe('normalizeCallTrace', () => {
  // ── Sequential IDs ──────────────────────────────────────────────────────

  it('assigns sequential IDs starting from call-0', () => {
    const trace = makeTrace({
      calls: [makeTrace(), makeTrace()],
    });

    const root = normalizeCallTrace(trace);

    expect(root.id).toBe('call-0');
    expect(root.children[0].id).toBe('call-1');
    expect(root.children[1].id).toBe('call-2');
  });

  it('assigns IDs depth-first across a nested tree', () => {
    const trace = makeTrace({
      calls: [
        makeTrace({ calls: [makeTrace()] }), // call-1 → call-2
        makeTrace(),                           // call-3
      ],
    });

    const root = normalizeCallTrace(trace);

    expect(root.id).toBe('call-0');
    expect(root.children[0].id).toBe('call-1');
    expect(root.children[0].children[0].id).toBe('call-2');
    expect(root.children[1].id).toBe('call-3');
  });

  // ── Concurrent calls get independent counters ───────────────────────────

  it('produces independent ID sequences for separate normalizeCallTrace calls', () => {
    const traceA = makeTrace({ calls: [makeTrace()] });
    const traceB = makeTrace({ calls: [makeTrace(), makeTrace()] });

    const rootA = normalizeCallTrace(traceA);
    const rootB = normalizeCallTrace(traceB);

    // Both roots start at 0 because each call creates its own counter
    expect(rootA.id).toBe('call-0');
    expect(rootA.children[0].id).toBe('call-1');

    expect(rootB.id).toBe('call-0');
    expect(rootB.children[0].id).toBe('call-1');
    expect(rootB.children[1].id).toBe('call-2');
  });

  // ── Call type mapping ──────────────────────────────────────────────────

  it('maps call types (CALL, STATICCALL, DELEGATECALL, CREATE)', () => {
    for (const ct of ['CALL', 'STATICCALL', 'DELEGATECALL', 'CREATE'] as const) {
      const root = normalizeCallTrace(makeTrace({ type: ct }));
      expect(root.callType).toBe(ct);
    }
  });

  it('defaults callType to CALL when type is missing', () => {
    const trace = makeTrace();
    // @ts-expect-error — testing missing value
    delete trace.type;
    const root = normalizeCallTrace(trace);
    expect(root.callType).toBe('CALL');
  });

  // ── Caller / callee normalisation ──────────────────────────────────────

  it('lowercases caller and callee addresses', () => {
    const root = normalizeCallTrace(
      makeTrace({ from: '0xABCDef', to: '0xFeDcBA' }),
    );

    expect(root.caller).toBe('0xabcdef');
    expect(root.callee).toBe('0xfedcba');
  });

  it('handles undefined from/to gracefully', () => {
    const trace = makeTrace();
    // @ts-expect-error — simulate missing addresses from bad API data
    delete trace.from;
    // @ts-expect-error
    delete trace.to;

    const root = normalizeCallTrace(trace);

    expect(root.caller).toBe('');
    expect(root.callee).toBe('');
  });

  // ── Success / failure ──────────────────────────────────────────────────

  it('marks success=true when no error field', () => {
    const root = normalizeCallTrace(makeTrace());
    expect(root.success).toBe(true);
    expect(root.revertReason).toBeUndefined();
  });

  it('marks success=false and captures revert reason from error_reason', () => {
    const root = normalizeCallTrace(
      makeTrace({ error: 'execution reverted', error_reason: 'Insufficient balance' }),
    );

    expect(root.success).toBe(false);
    expect(root.revertReason).toBe('Insufficient balance');
  });

  it('falls back to error field when error_reason is absent', () => {
    const root = normalizeCallTrace(
      makeTrace({ error: 'out of gas' }),
    );

    expect(root.success).toBe(false);
    expect(root.revertReason).toBe('out of gas');
  });

  // ── Gas / value ────────────────────────────────────────────────────────

  it('captures gasUsed and valueWei', () => {
    const root = normalizeCallTrace(
      makeTrace({ gas_used: 21_000, value: '0xde0b6b3a7640000' }),
    );

    expect(root.gasUsed).toBe(21_000);
    expect(root.valueWei).toBe('0xde0b6b3a7640000');
  });

  it('defaults gasUsed to 0 and valueWei to "0x0"', () => {
    const trace = makeTrace();
    // @ts-expect-error
    delete trace.gas_used;
    delete trace.value;

    const root = normalizeCallTrace(trace);

    expect(root.gasUsed).toBe(0);
    expect(root.valueWei).toBe('0x0');
  });

  // ── Decoded params ─────────────────────────────────────────────────────

  it('maps decoded inputs and outputs to DecodedParam[]', () => {
    const root = normalizeCallTrace(
      makeTrace({
        decoded_input: [
          { name: 'recipient', type: 'address', value: '0x1234' },
          { name: 'amount', type: 'uint256', value: '1000' },
        ],
        decoded_output: [{ name: 'success', type: 'bool', value: 'true' }],
      }),
    );

    expect(root.decodedInputs).toEqual([
      { name: 'recipient', type: 'address', value: '0x1234' },
      { name: 'amount', type: 'uint256', value: '1000' },
    ]);
    expect(root.decodedOutputs).toEqual([
      { name: 'success', type: 'bool', value: 'true' },
    ]);
  });

  it('returns empty arrays when decoded_input/decoded_output are undefined', () => {
    const root = normalizeCallTrace(makeTrace());
    expect(root.decodedInputs).toEqual([]);
    expect(root.decodedOutputs).toEqual([]);
  });

  it('serializes non-string param values to string', () => {
    const root = normalizeCallTrace(
      makeTrace({
        decoded_input: [
          { name: 'count', type: 'uint256', value: 42 as unknown as string },
          { name: 'flag', type: 'bool', value: true as unknown as string },
          { name: 'data', type: 'bytes', value: null as unknown as string },
        ],
      }),
    );

    expect(root.decodedInputs[0].value).toBe('42');
    expect(root.decodedInputs[1].value).toBe('true');
    expect(root.decodedInputs[2].value).toBe('');
  });

  // ── Children recursion ─────────────────────────────────────────────────

  it('recursively normalizes children with incrementing depth', () => {
    const trace = makeTrace({
      calls: [
        makeTrace({
          from: '0xChild1From',
          to: '0xChild1To',
          calls: [makeTrace({ from: '0xGrandChild', to: '0xGrandChildTo' })],
        }),
      ],
    });

    const root = normalizeCallTrace(trace);

    expect(root.depth).toBe(0);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].depth).toBe(1);
    expect(root.children[0].caller).toBe('0xchild1from');
    expect(root.children[0].children).toHaveLength(1);
    expect(root.children[0].children[0].depth).toBe(2);
    expect(root.children[0].children[0].caller).toBe('0xgrandchild');
  });

  it('produces empty children array for leaf calls', () => {
    const root = normalizeCallTrace(makeTrace());
    expect(root.children).toEqual([]);
  });

  // ── Selector lookup enrichment ─────────────────────────────────────────

  it('enriches protocol and action from known selector (ERC20 approve)', () => {
    // 0x095ea7b3 = approve(address,uint256) → protocol: 'ERC20', action: 'Approve'
    const root = normalizeCallTrace(
      makeTrace({ input: '0x095ea7b3000000000000000000000000abcdef' }),
    );

    expect(root.functionSelector).toBe('0x095ea7b3');
    expect(root.protocol).toBe('ERC20');
    expect(root.action).toBe('Approve');
  });

  it('enriches protocol from Uniswap V3 exactInputSingle selector', () => {
    // 0x414bf389 = exactInputSingle(...)
    const root = normalizeCallTrace(
      makeTrace({ input: '0x414bf38900000000000000000000' }),
    );

    expect(root.functionSelector).toBe('0x414bf389');
    expect(root.protocol).toBe('Uniswap V3');
    expect(root.action).toBe('Swap');
  });

  it('falls back to selector functionSignature when function_name is missing', () => {
    const root = normalizeCallTrace(
      makeTrace({ input: '0x095ea7b3000000000000000000', function_name: undefined }),
    );

    expect(root.functionName).toBe('approve(address,uint256)');
  });

  it('prefers trace function_name over selector lookup', () => {
    const root = normalizeCallTrace(
      makeTrace({ input: '0x095ea7b3000000000000', function_name: 'approve' }),
    );

    expect(root.functionName).toBe('approve');
  });

  it('leaves protocol/action undefined for unknown selectors', () => {
    const root = normalizeCallTrace(
      makeTrace({ input: '0xdeadbeef00000000000000000000' }),
    );

    expect(root.functionSelector).toBe('0xdeadbeef');
    expect(root.protocol).toBeUndefined();
    expect(root.action).toBeUndefined();
  });

  it('handles input shorter than 10 chars (no selector)', () => {
    const root = normalizeCallTrace(makeTrace({ input: '0x' }));
    expect(root.functionSelector).toBeUndefined();
    expect(root.protocol).toBeUndefined();
  });
});
