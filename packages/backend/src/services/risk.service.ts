import { ethers } from 'ethers';
import type { NormalizedCall, TokenFlow, SemanticAction, RiskFlag } from '@debugger/shared';

const MAX_UINT256 = (2n ** 256n - 1n).toString();
const ETH_LARGE_THRESHOLD = ethers.parseEther('10'); // 10 ETH
const USD_LARGE_THRESHOLD = 50_000; // $50k

function flattenCalls(node: NormalizedCall): NormalizedCall[] {
  return [node, ...node.children.flatMap(flattenCalls)];
}

function checkUnlimitedApproval(calls: NormalizedCall[]): RiskFlag[] {
  const flags: RiskFlag[] = [];

  for (const call of calls) {
    if (call.functionSelector === '0x095ea7b3') {
      const amountParam = call.decodedInputs.find(
        i => i.name === 'amount' || i.name === 'value' || i.name === '_value'
      );
      if (amountParam?.value === MAX_UINT256 || amountParam?.value === 'MaxUint256') {
        flags.push({
          level: 'medium',
          type: 'UNLIMITED_APPROVAL',
          description: `Unlimited ERC20 approval granted to ${call.callee}. This allows the spender to move all tokens at any time.`,
          callId: call.id,
        });
      }
    }
  }

  return flags;
}

function checkFlashloan(actions: SemanticAction[]): RiskFlag[] {
  return actions
    .filter(a => a.type === 'Flashloan')
    .map(a => ({
      level: 'medium' as const,
      type: 'FLASHLOAN_USAGE',
      description: `Flashloan detected via ${a.protocol ?? 'unknown protocol'}. Flashloans can be used for legitimate arbitrage but are also used in attack vectors.`,
      callId: a.callId,
    }));
}

function checkLargeTransfers(tokenFlows: TokenFlow[]): RiskFlag[] {
  const flags: RiskFlag[] = [];

  for (const flow of tokenFlows) {
    if (flow.type === 'NativeTransfer') {
      try {
        const amountWei = BigInt(flow.rawAmount);
        if (amountWei >= ETH_LARGE_THRESHOLD) {
          flags.push({
            level: 'medium',
            type: 'LARGE_ETH_TRANSFER',
            description: `Large ETH transfer of ${flow.formattedAmount} ETH from ${flow.from} to ${flow.to}.`,
          });
        }
      } catch { /* skip malformed */ }
    }

    if (flow.dollarValue) {
      const usdValue = parseFloat(flow.dollarValue.replace(/[^0-9.]/g, ''));
      if (!isNaN(usdValue) && usdValue >= USD_LARGE_THRESHOLD) {
        flags.push({
          level: 'medium',
          type: 'LARGE_TOKEN_TRANSFER',
          description: `Large token transfer of ${flow.formattedAmount} ${flow.tokenSymbol} (~$${usdValue.toLocaleString()}).`,
        });
      }
    }
  }

  return flags;
}

function checkDelegatecallRisk(calls: NormalizedCall[]): RiskFlag[] {
  return calls
    .filter(c => c.callType === 'DELEGATECALL' && !c.contractName)
    .map(c => ({
      level: 'high' as const,
      type: 'DELEGATECALL_TO_UNKNOWN',
      description: `DELEGATECALL to unverified/unlabeled contract ${c.callee}. This allows the callee to execute with the caller's storage context.`,
      callId: c.id,
    }));
}

function checkSuspiciousDestination(callTree: NormalizedCall): RiskFlag[] {
  const rootCallee = callTree.callee;
  if (!callTree.contractName && callTree.depth === 0) {
    return [{
      level: 'low',
      type: 'UNVERIFIED_CONTRACT',
      description: `The top-level call targets contract ${rootCallee} which has no verified name/ABI on Tenderly. Verify this contract before trusting the transaction.`,
    }];
  }
  return [];
}

export function detectRisks(
  callTree: NormalizedCall,
  tokenFlows: TokenFlow[],
  actions: SemanticAction[]
): RiskFlag[] {
  const allCalls = flattenCalls(callTree);

  return [
    ...checkUnlimitedApproval(allCalls),
    ...checkFlashloan(actions),
    ...checkLargeTransfers(tokenFlows),
    ...checkDelegatecallRisk(allCalls),
    ...checkSuspiciousDestination(callTree),
  ];
}
