import type { NormalizedCall, FailureReason } from '@debugger/shared';

function flattenCalls(node: NormalizedCall): NormalizedCall[] {
  return [node, ...node.children.flatMap(flattenCalls)];
}

function categorizeRevertReason(reason: string): string {
  const r = reason.toLowerCase().trim();

  if (r.includes('allowance') || r.includes('approve') || r.includes('exceeds')) return 'Insufficient token allowance';
  if (r.includes('insufficient') || r.includes('balance')) return 'Insufficient balance';
  if (r.includes('slippage') || r.includes('too little received') || r.includes('min amount')) return 'Slippage exceeded';
  if (r.includes('expired') || r.includes('deadline')) return 'Transaction deadline expired';
  if (r.includes('access') || r.includes('owner') || r.includes('unauthorized') || r.includes('forbidden') || r.includes('not allowed')) return 'Access control violation';
  if (r.includes('overflow') || r.includes('underflow') || r.includes('arithmetic')) return 'Arithmetic error';
  if (r.includes('out of gas') || r.includes('gas')) return 'Out of gas';
  if (r.includes('reentrant') || r.includes('reentrancy')) return 'Reentrancy guard triggered';
  if (r.includes('paused')) return 'Contract is paused';
  if (r.includes('liquidity') || r.includes('reserves')) return 'Insufficient liquidity';
  if (r.includes('health') || r.includes('collateral')) return 'Health factor / collateral violation';
  if (r.includes('price') || r.includes('oracle')) return 'Price oracle issue';
  if (r.includes('transfer')) return 'Token transfer failed';
  if (r === 'execution reverted' || r === '') return 'Generic revert (no message)';

  return 'Contract reverted';
}

function buildExplanation(reason: string, call: NormalizedCall): string {
  const category = categorizeRevertReason(reason);
  const contract = call.contractName ?? call.callee;
  const fn = call.functionName?.split('(')[0] ?? call.functionSelector ?? 'unknown function';

  switch (category) {
    case 'Insufficient balance':
      return `${contract} rejected the call to ${fn} because an account lacked sufficient token or ETH balance.`;
    case 'Slippage exceeded':
      return `The swap in ${contract} failed because the received amount fell below the minimum threshold. The price moved unfavorably between submission and execution.`;
    case 'Transaction deadline expired':
      return `${contract} rejected the transaction because the deadline timestamp had already passed. Resubmit with a fresh deadline.`;
    case 'Insufficient token allowance':
      return `${contract}.${fn} tried to spend tokens on behalf of a user but the ERC20 allowance was too low. An approve() call is needed first.`;
    case 'Access control violation':
      return `The caller does not have the required role or ownership to call ${fn} on ${contract}.`;
    case 'Out of gas':
      return `The call to ${contract}.${fn} ran out of gas. Increase the gas limit for this transaction.`;
    case 'Reentrancy guard triggered':
      return `${contract} rejected a reentrant call to ${fn}. A nonReentrant modifier blocked re-entry into the contract.`;
    case 'Contract is paused':
      return `${contract} is currently paused and not accepting calls to ${fn}.`;
    case 'Insufficient liquidity':
      return `${contract} could not fulfill the operation — the pool or market does not have enough liquidity.`;
    case 'Health factor / collateral violation':
      return `The operation was blocked by ${contract} because it would leave the position undercollateralized (health factor would drop below 1).`;
    case 'Price oracle issue':
      return `${contract} rejected the call due to a stale or invalid price feed response.`;
    case 'Token transfer failed':
      return `A token transfer inside ${contract}.${fn} failed. The recipient may have a transfer hook that reverted, or the token balance was insufficient.`;
    case 'Generic revert (no message)':
      return `${contract}.${fn} reverted without a reason string. This is often a low-level assembly revert, an out-of-gas condition, or a custom error that was not decoded.`;
    default:
      return `${contract}.${fn} reverted with: "${reason.trim()}"`;
  }
}

export function analyzeFailure(callTree: NormalizedCall): FailureReason | undefined {
  if (callTree.success) return undefined;

  const allCalls = flattenCalls(callTree);
  // Include calls with no reason string too — they may have raw revert data
  const failedCalls = allCalls.filter(c => !c.success);
  const failedWithReason = failedCalls.filter(c => c.revertReason);

  if (failedWithReason.length === 0 && failedCalls.length === 0) {
    return {
      rootCallId: callTree.id,
      reason: 'Unknown revert',
      explanation: 'The transaction reverted without a decodable reason string.',
    };
  }

  // Find the deepest failed leaf — a call that reverted with no reverted children.
  const candidates = failedWithReason.length > 0 ? failedWithReason : failedCalls;
  let rootCause: NormalizedCall | undefined;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i]!.children.every(child => child.success)) {
      rootCause = candidates[i];
      break;
    }
  }
  rootCause ??= candidates[candidates.length - 1]!;

  const reason = rootCause.revertReason ?? 'execution reverted';
  const explanation = buildExplanation(reason, rootCause);

  // Append raw revert context for unverified/no-reason calls
  const rawContext: string[] = [];
  if (rootCause.customErrorSelector) {
    rawContext.push(`Custom error selector: ${rootCause.customErrorSelector} (contract ${rootCause.callee} is unverified — look up this 4-byte selector at https://www.4byte.directory/signatures/?bytes4_signature=${rootCause.customErrorSelector})`);
  }
  if (rootCause.rawRevertData && !rootCause.customErrorSelector) {
    rawContext.push(`Raw revert bytes: ${rootCause.rawRevertData}`);
  }
  if (rootCause.callInput && !rootCause.functionName) {
    rawContext.push(`Failing calldata: ${rootCause.callInput.slice(0, 138)}${rootCause.callInput.length > 138 ? '…' : ''}`);
    rawContext.push(`Target (unverified): ${rootCause.callee}`);
  }

  return {
    rootCallId: rootCause.id,
    reason,
    explanation: rawContext.length > 0 ? `${explanation}\n${rawContext.join('\n')}` : explanation,
  };
}
