import { describe, it, expect } from 'vitest';
import { analyzeFailure } from '../services/failure.service.js';
import type { NormalizedCall } from '@debugger/shared';

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

// ---------- tests ----------

describe('analyzeFailure', () => {
  // ── Successful transactions ────────────────────────────────────────────

  it('returns undefined for successful transactions', () => {
    const tree = makeCall({ success: true });
    expect(analyzeFailure(tree)).toBeUndefined();
  });

  it('returns undefined for a successful tree even with successful children', () => {
    const tree = makeCall({
      success: true,
      children: [
        makeCall({ id: 'call-1', depth: 1, success: true }),
      ],
    });
    expect(analyzeFailure(tree)).toBeUndefined();
  });

  // ── Deepest failed call ───────────────────────────────────────────────

  it('finds the deepest failed call with a revert reason', () => {
    const tree = makeCall({
      success: false,
      revertReason: 'top level revert',
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          success: false,
          revertReason: 'mid level revert',
          children: [
            makeCall({
              id: 'call-2',
              depth: 2,
              success: false,
              revertReason: 'Insufficient balance',
            }),
          ],
        }),
      ],
    });

    const failure = analyzeFailure(tree);

    expect(failure).toBeDefined();
    expect(failure!.rootCallId).toBe('call-2');
    expect(failure!.reason).toBe('Insufficient balance');
  });

  it('picks the last failed call in flattened order (deepest)', () => {
    const tree = makeCall({
      success: false,
      revertReason: 'top revert',
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          success: false,
          revertReason: 'branch A error',
        }),
        makeCall({
          id: 'call-2',
          depth: 1,
          success: false,
          revertReason: 'branch B error',
        }),
      ],
    });

    const failure = analyzeFailure(tree);

    // The flatten order is: call-0, call-1, call-2
    // The last failed call with a revert reason is call-2
    expect(failure!.rootCallId).toBe('call-2');
    expect(failure!.reason).toBe('branch B error');
  });

  // ── No revert reason in children ──────────────────────────────────────

  it('returns root-level failure when no child has a revert reason', () => {
    const tree = makeCall({
      success: false,
      revertReason: 'Unknown revert',
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          success: false,
          // no revertReason
        }),
      ],
    });

    const failure = analyzeFailure(tree);

    expect(failure).toBeDefined();
    // Root has a revertReason so it becomes rootCause via the normal path
    expect(failure!.rootCallId).toBe('call-0');
    expect(failure!.reason).toBe('Unknown revert');
    // "Unknown revert" doesn't match any specific category, so buildExplanation
    // returns the default "Contract reverted" message
    expect(failure!.explanation).toContain('reverted with');
    expect(failure!.explanation).toContain('Unknown revert');
  });

  it('returns fallback when no call in the tree has a revert reason', () => {
    const tree = makeCall({
      success: false,
      // no revertReason on root
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          success: false,
          // no revertReason
        }),
      ],
    });

    const failure = analyzeFailure(tree);

    expect(failure).toBeDefined();
    expect(failure!.rootCallId).toBe('call-0');
    // Falls into the failedCalls.length === 0 branch
    expect(failure!.reason).toBe('Unknown revert');
    expect(failure!.explanation).toBe('The transaction reverted without a decodable reason string.');
  });

  it('falls back to "Unknown revert" when root has no revertReason either', () => {
    const tree = makeCall({
      success: false,
      // no revertReason on root or children
      children: [
        makeCall({ id: 'call-1', depth: 1, success: false }),
      ],
    });

    const failure = analyzeFailure(tree);

    expect(failure).toBeDefined();
    expect(failure!.reason).toBe('Unknown revert');
  });

  // ── categorizeRevertReason coverage ───────────────────────────────────

  describe('categorizeRevertReason via explanation strings', () => {
    function getExplanationForReason(reason: string): string {
      const tree = makeCall({
        success: false,
        contractName: 'TestContract',
        functionName: 'testFunc',
        children: [
          makeCall({
            id: 'call-1',
            depth: 1,
            success: false,
            revertReason: reason,
            contractName: 'InnerContract',
            functionName: 'innerFunc(uint256)',
          }),
        ],
      });

      return analyzeFailure(tree)!.explanation;
    }

    it('categorizes "insufficient balance"', () => {
      const explanation = getExplanationForReason('ERC20: Insufficient balance');
      expect(explanation).toContain('lacked sufficient token or ETH balance');
    });

    it('categorizes "too little received" as slippage', () => {
      const explanation = getExplanationForReason('Too little received');
      expect(explanation).toContain('price moved unfavorably');
    });

    it('categorizes "min amount" as slippage', () => {
      const explanation = getExplanationForReason('Output below min amount');
      expect(explanation).toContain('minimum threshold');
    });

    it('categorizes "deadline expired"', () => {
      const explanation = getExplanationForReason('Transaction deadline expired');
      expect(explanation).toContain('deadline timestamp');
    });

    it('categorizes "allowance exceeded"', () => {
      const explanation = getExplanationForReason('ERC20: transfer amount exceeds allowance');
      expect(explanation).toContain('allowance was too low');
    });

    it('categorizes "owner" as access control', () => {
      const explanation = getExplanationForReason('Ownable: caller is not the owner');
      expect(explanation).toContain('required role or ownership');
    });

    it('categorizes "unauthorized" as access control', () => {
      const explanation = getExplanationForReason('Unauthorized');
      expect(explanation).toContain('required role or ownership');
    });

    it('categorizes "arithmetic overflow"', () => {
      const explanation = getExplanationForReason('Arithmetic overflow');
      // categorizeRevertReason returns 'Arithmetic error' but buildExplanation
      // has no switch case for it, so it falls through to default
      expect(explanation).toContain('reverted with');
      expect(explanation).toContain('Arithmetic overflow');
    });

    it('categorizes "out of gas"', () => {
      const explanation = getExplanationForReason('out of gas');
      expect(explanation).toContain('ran out of gas');
    });

    it('categorizes "reentrancy" guard', () => {
      const explanation = getExplanationForReason('ReentrancyGuard: reentrant call');
      expect(explanation).toContain('nonReentrant modifier');
    });

    it('categorizes "paused" contract', () => {
      const explanation = getExplanationForReason('Pausable: paused');
      expect(explanation).toContain('currently paused');
    });

    it('categorizes "insufficient liquidity" (matches "insufficient" first)', () => {
      const explanation = getExplanationForReason('INSUFFICIENT_LIQUIDITY');
      // "insufficient_liquidity" matches the "insufficient" check first in
      // categorizeRevertReason, returning 'Insufficient balance'
      expect(explanation).toContain('lacked sufficient token or ETH balance');
    });

    it('categorizes pure "liquidity" / "reserves" as insufficient liquidity', () => {
      const explanation = getExplanationForReason('Not enough liquidity in reserves');
      expect(explanation).toContain('enough liquidity');
    });

    it('categorizes "health factor" / collateral', () => {
      const explanation = getExplanationForReason('Health factor below threshold');
      expect(explanation).toContain('undercollateralized');
    });

    it('categorizes "oracle" / price issue', () => {
      const explanation = getExplanationForReason('Oracle: stale price');
      expect(explanation).toContain('price feed');
    });

    it('categorizes "transfer" failure', () => {
      const explanation = getExplanationForReason('SafeERC20: low-level transfer failed');
      expect(explanation).toContain('transfer inside');
    });

    it('categorizes bare "execution reverted" as generic', () => {
      const explanation = getExplanationForReason('execution reverted');
      expect(explanation).toContain('reverted without a reason string');
    });

    it('categorizes empty string as generic revert', () => {
      const explanation = getExplanationForReason('');
      // buildExplanation for 'Generic revert (no message)' says "reverted without a decodable reason string"
      expect(explanation).toContain('reverted without');
      expect(explanation).toContain('reason string');
    });

    it('falls back to "Contract reverted" for unrecognised reasons', () => {
      const explanation = getExplanationForReason('CUSTOM_ERROR_CODE_XYZ');
      expect(explanation).toContain('reverted with');
      expect(explanation).toContain('CUSTOM_ERROR_CODE_XYZ');
    });
  });

  // ── Explanation uses contract/function info ───────────────────────────

  it('includes contract name and function name in explanation', () => {
    const tree = makeCall({
      success: false,
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          success: false,
          revertReason: 'Insufficient balance',
          contractName: 'USDC',
          functionName: 'transfer(address,uint256)',
        }),
      ],
    });

    const failure = analyzeFailure(tree);

    expect(failure!.explanation).toContain('USDC');
    expect(failure!.explanation).toContain('transfer');
  });

  it('falls back to callee address when contractName is missing', () => {
    const tree = makeCall({
      success: false,
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          success: false,
          revertReason: 'Insufficient balance',
          callee: '0xdeadbeef',
          // no contractName
        }),
      ],
    });

    const failure = analyzeFailure(tree);

    expect(failure!.explanation).toContain('0xdeadbeef');
  });

  it('falls back to functionSelector when functionName is missing', () => {
    const tree = makeCall({
      success: false,
      children: [
        makeCall({
          id: 'call-1',
          depth: 1,
          success: false,
          revertReason: 'Paused',
          functionSelector: '0xabcdef12',
          contractName: 'SomeContract',
          // no functionName
        }),
      ],
    });

    const failure = analyzeFailure(tree);

    expect(failure!.explanation).toContain('0xabcdef12');
  });
});
