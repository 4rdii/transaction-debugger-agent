import type { NormalizedCall, TokenFlow, SemanticAction } from '@debugger/shared';
import {
  SWAP_SELECTORS,
  FLASHLOAN_SELECTORS,
  APPROVE_SELECTORS,
  MULTICALL_SELECTORS,
  BRIDGE_ADDRESSES,
} from '../registry/selectors.js';

function flattenCalls(node: NormalizedCall): NormalizedCall[] {
  return [node, ...node.children.flatMap(flattenCalls)];
}

function getTokensInvolved(callId: string, tokenFlows: TokenFlow[]): string[] {
  // Returns unique token symbols involved in flows
  return [...new Set(tokenFlows.map(f => f.tokenSymbol))];
}

function getAddressesInvolved(call: NormalizedCall): string[] {
  return [...new Set([call.caller, call.callee])];
}

function detectSwap(
  call: NormalizedCall,
  tokenFlows: TokenFlow[],
  allCalls: NormalizedCall[]
): SemanticAction | null {
  const sel = call.functionSelector;
  if (!sel) return null;

  // Check if this call's selector is a known swap
  if (SWAP_SELECTORS.has(sel)) {
    const uniqueTokens = [...new Set(tokenFlows.map(f => f.tokenSymbol))];
    return {
      type: 'Swap',
      protocol: call.protocol,
      callId: call.id,
      description: `${call.protocol ?? 'Unknown'} swap via ${call.functionName ?? sel}`,
      involvedTokens: uniqueTokens,
      involvedAddresses: getAddressesInvolved(call),
    };
  }

  // Heuristic: ≥2 different token transfers happening in children + AMM-like callee name
  const childTransfers = tokenFlows.filter(f => f.type === 'Transfer');
  const uniqueTokensInSubtree = new Set(childTransfers.map(f => f.tokenAddress));
  const contractName = (call.contractName ?? '').toLowerCase();
  const isAmm =
    contractName.includes('router') ||
    contractName.includes('swap') ||
    contractName.includes('pool') ||
    contractName.includes('pair');

  if (uniqueTokensInSubtree.size >= 2 && isAmm) {
    return {
      type: 'Swap',
      protocol: call.protocol ?? call.contractName,
      callId: call.id,
      description: `Token swap on ${call.contractName ?? call.callee}`,
      involvedTokens: [...new Set(childTransfers.map(f => f.tokenSymbol))],
      involvedAddresses: getAddressesInvolved(call),
    };
  }

  return null;
}

function detectApprove(call: NormalizedCall): SemanticAction | null {
  if (!call.functionSelector || !APPROVE_SELECTORS.has(call.functionSelector)) return null;

  const spender = call.decodedInputs.find(i => i.name === 'spender' || i.type === 'address')?.value ?? call.callee;
  const amount = call.decodedInputs.find(i => i.name === 'amount' || i.name === 'value')?.value ?? 'unknown';

  return {
    type: 'Approve',
    protocol: 'ERC20',
    callId: call.id,
    description: `Token approval to ${spender} for amount ${amount}`,
    involvedTokens: [],
    involvedAddresses: [call.caller, call.callee, spender],
  };
}

function detectFlashloan(call: NormalizedCall): SemanticAction | null {
  if (!call.functionSelector || !FLASHLOAN_SELECTORS.has(call.functionSelector)) return null;

  return {
    type: 'Flashloan',
    protocol: call.protocol,
    callId: call.id,
    description: `Flashloan via ${call.protocol ?? call.contractName ?? call.callee}`,
    involvedTokens: [],
    involvedAddresses: getAddressesInvolved(call),
  };
}

function detectMulticall(call: NormalizedCall): SemanticAction | null {
  if (!call.functionSelector || !MULTICALL_SELECTORS.has(call.functionSelector)) return null;

  return {
    type: 'Multicall',
    protocol: call.protocol,
    callId: call.id,
    description: `Multicall with ${call.children.length} sub-calls`,
    involvedTokens: [],
    involvedAddresses: getAddressesInvolved(call),
  };
}

function detectBridge(call: NormalizedCall): SemanticAction | null {
  const isKnownBridge = BRIDGE_ADDRESSES.has(call.callee);
  const hasBridgeEvent = call.contractName?.toLowerCase().includes('bridge');
  const hasBridgeFunction = call.functionName?.toLowerCase().includes('bridge') ||
    call.functionName?.toLowerCase().includes('deposit');

  if (isKnownBridge || (hasBridgeEvent && hasBridgeFunction)) {
    return {
      type: 'Bridge',
      protocol: call.contractName,
      callId: call.id,
      description: `Cross-chain bridge operation via ${call.contractName ?? call.callee}`,
      involvedTokens: [],
      involvedAddresses: getAddressesInvolved(call),
    };
  }
  return null;
}

function detectDepositWithdraw(call: NormalizedCall, tokenFlows: TokenFlow[]): SemanticAction | null {
  const fnName = (call.functionName ?? '').toLowerCase();
  const contractName = (call.contractName ?? '').toLowerCase();

  const isLendingProtocol =
    contractName.includes('lending') ||
    contractName.includes('aave') ||
    contractName.includes('compound') ||
    contractName.includes('pool');

  if (!isLendingProtocol) return null;

  if (fnName.includes('deposit') || fnName.includes('supply')) {
    return {
      type: 'Deposit',
      protocol: call.protocol ?? call.contractName,
      callId: call.id,
      description: `Deposit/supply to ${call.contractName ?? call.callee}`,
      involvedTokens: getTokensInvolved(call.id, tokenFlows),
      involvedAddresses: getAddressesInvolved(call),
    };
  }

  if (fnName.includes('withdraw') || fnName.includes('redeem')) {
    return {
      type: 'Withdraw',
      protocol: call.protocol ?? call.contractName,
      callId: call.id,
      description: `Withdrawal from ${call.contractName ?? call.callee}`,
      involvedTokens: getTokensInvolved(call.id, tokenFlows),
      involvedAddresses: getAddressesInvolved(call),
    };
  }

  return null;
}

function detectLiquidation(call: NormalizedCall): SemanticAction | null {
  const fnName = (call.functionName ?? '').toLowerCase();
  const sel = call.functionSelector ?? '';

  if (fnName.includes('liquidat') || sel === '0xdfd5281b') {
    return {
      type: 'Liquidation',
      protocol: call.protocol ?? call.contractName,
      callId: call.id,
      description: `Liquidation on ${call.contractName ?? call.callee}`,
      involvedTokens: [],
      involvedAddresses: getAddressesInvolved(call),
    };
  }
  return null;
}

export function detectSemanticActions(
  callTree: NormalizedCall,
  tokenFlows: TokenFlow[]
): SemanticAction[] {
  const allCalls = flattenCalls(callTree);
  const actions: SemanticAction[] = [];
  const seen = new Set<string>();

  for (const call of allCalls) {
    // Skip duplicate protocol+action combos from nested calls
    const key = `${call.protocol}-${call.functionSelector}-${call.depth}`;
    if (seen.has(key)) continue;

    const detected =
      detectFlashloan(call) ??
      detectSwap(call, tokenFlows, allCalls) ??
      detectApprove(call) ??
      detectMulticall(call) ??
      detectBridge(call) ??
      detectLiquidation(call) ??
      detectDepositWithdraw(call, tokenFlows);

    if (detected) {
      actions.push(detected);
      seen.add(key);
    }
  }

  // If no high-level action but there are ERC20 transfers, add Transfer
  if (actions.length === 0) {
    const transfers = tokenFlows.filter(f => f.type === 'Transfer');
    if (transfers.length > 0) {
      actions.push({
        type: 'Transfer',
        protocol: 'ERC20',
        callId: callTree.id,
        description: `Token transfer of ${transfers.map(t => t.tokenSymbol).join(', ')}`,
        involvedTokens: [...new Set(transfers.map(t => t.tokenSymbol))],
        involvedAddresses: [...new Set(transfers.flatMap(t => [t.from, t.to]))],
      });
    }
  }

  return actions;
}
