import OpenAI from 'openai';
import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  NormalizedCall,
  TokenFlow,
  SemanticAction,
  SemanticActionType,
  RiskFlag,
  FailureReason,
  TonTxData,
  TonEventAction,
} from '@debugger/shared';
import { config } from '../config.js';
import { getOpenAI } from './openai.service.js';
import { extractTonTokenFlows } from './ton-tokenflow.service.js';
import {
  TON_DEX_CONTRACTS,
  TON_BRIDGE_CONTRACTS,
  lookupTonContractName,
  lookupTonOpCode,
} from '../registry/ton-contracts.js';
import { traceTonTransaction, formatTxTracerForPrompt, type TxTracerResult } from './ton-txtracer.service.js';
import { resolveContractSource, formatSourceForPrompt } from './ton-source.service.js';
import { parseAddressLabels } from './agent.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, '../../../logs');

const MAX_TURNS = 4;
const NANOTON = 1_000_000_000;

// ─── Agent state ─────────────────────────────────────────────────────────────

export interface TonAgentState {
  txHash: string;
  networkId: string;
  success: boolean;
  exitCode: number;
  lt: string;
  utime: number;
  fee: string;
  account: string;
  callTree: NormalizedCall;
  txData: TonTxData;
  tokenFlows: TokenFlow[];
  semanticActions: SemanticAction[];
  riskFlags: RiskFlag[];
  failureReason: FailureReason | undefined;
}

// ─── Call tree text builder ─────────────────────────────────────────────────

function buildTonCallTreeText(
  node: NormalizedCall,
  depth = 0,
  lines: string[] = [],
): string[] {
  const indent = '  '.repeat(depth);
  const status = node.success ? '✓' : '✗ FAILED';
  const callType = node.callType ?? 'MESSAGE';
  const contract = node.contractName
    ? `${node.contractName} [${node.callee.slice(0, 12)}...]`
    : `${node.callee.slice(0, 16)}...`;
  const fn = node.functionName ? `.${node.functionName}` : '';
  const value = BigInt(node.valueWei || '0');
  const tonValue = value > 0n
    ? ` | ${(Number(value) / NANOTON).toFixed(4)} TON`
    : '';
  const fee = node.gasUsed > 0
    ? ` | fee: ${(node.gasUsed / NANOTON).toFixed(6)} TON`
    : '';
  const revert = !node.success && node.revertReason ? ` — "${node.revertReason}"` : '';
  const protocol = node.protocol ? ` [${node.protocol}]` : '';

  lines.push(`${indent}${callType} ${contract}${fn}${protocol}${tonValue}${fee} | ${status}${revert}`);

  for (const child of node.children) {
    buildTonCallTreeText(child, depth + 1, lines);
  }

  return lines;
}

// ─── Deterministic analysis functions ───────────────────────────────────────

function flattenCalls(node: NormalizedCall): NormalizedCall[] {
  return [node, ...node.children.flatMap(flattenCalls)];
}

function detectTonActions(state: TonAgentState): SemanticAction[] {
  const allCalls = flattenCalls(state.callTree);
  const actions: SemanticAction[] = [];
  const names = state.txData.accountNames;
  const labelAddr = (addr: string) =>
    lookupTonContractName(addr) ?? names.get(addr) ?? addr.slice(0, 16) + '...';

  // ─── Use TonAPI event actions first (authoritative, pre-parsed) ───────────
  for (const ea of state.txData.eventActions ?? []) {
    // JettonSwap — structured DEX swap data
    if (ea.type === 'JettonSwap' && ea.swap) {
      const s = ea.swap;
      const fmtIn = formatAmount(s.amountIn, s.decimalsIn ?? 9);
      const fmtOut = formatAmount(s.amountOut, s.decimalsOut ?? 9);
      actions.push({
        type: 'Swap',
        protocol: s.dex,
        callId: state.callTree.id,
        description: `Swapped ${fmtIn} ${s.symbolIn} → ${fmtOut} ${s.symbolOut} via ${s.dex}`,
        involvedTokens: [s.symbolIn ?? 'unknown', s.symbolOut ?? 'unknown'],
        involvedAddresses: [s.router],
      });
    }

    // JettonBurn
    if (ea.type === 'JettonBurn' && ea.burn) {
      const b = ea.burn;
      const fmtAmt = formatAmount(b.amount, b.decimals ?? 9);
      actions.push({
        type: 'Burn' as SemanticActionType,
        protocol: b.symbol ?? 'Jetton',
        callId: state.callTree.id,
        description: `Burned ${fmtAmt} ${b.symbol ?? 'tokens'}`,
        involvedTokens: [b.symbol ?? b.tokenAddress.slice(0, 12)],
        involvedAddresses: [b.sender, b.tokenAddress],
      });
    }

    // JettonMint
    if (ea.type === 'JettonMint' && ea.mint) {
      const m = ea.mint;
      const fmtAmt = formatAmount(m.amount, m.decimals ?? 9);
      actions.push({
        type: 'Mint' as SemanticActionType,
        protocol: m.symbol ?? 'Jetton',
        callId: state.callTree.id,
        description: `Minted ${fmtAmt} ${m.symbol ?? 'tokens'} to ${labelAddr(m.recipient)}`,
        involvedTokens: [m.symbol ?? m.tokenAddress.slice(0, 12)],
        involvedAddresses: [m.recipient, m.tokenAddress],
      });
    }

    // ContractDeploy
    if (ea.type === 'ContractDeploy' && ea.deploy) {
      const d = ea.deploy;
      actions.push({
        type: 'ContractCreation' as SemanticActionType,
        protocol: d.interfaces.join(', ') || 'unknown',
        callId: state.callTree.id,
        description: `Deployed contract ${labelAddr(d.address)}${d.interfaces.length ? ` (${d.interfaces.join(', ')})` : ''}`,
        involvedTokens: [],
        involvedAddresses: [d.address],
      });
    }

    // DepositStake / WithdrawStake / WithdrawStakeRequest
    if ((ea.type === 'DepositStake' || ea.type === 'WithdrawStake' || ea.type === 'WithdrawStakeRequest') && ea.stake) {
      const s = ea.stake;
      const isDeposit = ea.type === 'DepositStake';
      const fmtAmt = (Number(s.amount) / NANOTON).toFixed(4);
      actions.push({
        type: isDeposit ? 'Deposit' : 'Withdraw',
        protocol: labelAddr(s.pool),
        callId: state.callTree.id,
        description: `${isDeposit ? 'Staked' : ea.type === 'WithdrawStakeRequest' ? 'Requested unstake of' : 'Unstaked'} ${fmtAmt} TON via ${labelAddr(s.pool)}`,
        involvedTokens: ['TON'],
        involvedAddresses: [s.staker, s.pool],
      });
    }

    // NftPurchase
    if (ea.type === 'NftPurchase' && ea.nftPurchase) {
      const n = ea.nftPurchase;
      const fmtPrice = (Number(n.price) / NANOTON).toFixed(4);
      actions.push({
        type: 'Transfer' as SemanticActionType,
        protocol: 'NFT Marketplace',
        callId: state.callTree.id,
        description: `NFT purchased for ${fmtPrice} TON by ${labelAddr(n.buyer)} from ${labelAddr(n.seller)}${n.auctionType ? ` (${n.auctionType})` : ''}`,
        involvedTokens: ['TON'],
        involvedAddresses: [n.buyer, n.seller, n.nftAddress],
      });
    }

    // SmartContractExec — generic contract interaction
    if (ea.type === 'SmartContractExec' && ea.contractExec) {
      const e = ea.contractExec;
      const fmtTon = (Number(e.tonAttached) / NANOTON).toFixed(4);
      // Only add if not already covered by another action type
      const contractAlreadyCovered = actions.some(a =>
        a.involvedAddresses?.includes(e.contract),
      );
      if (!contractAlreadyCovered) {
        actions.push({
          type: 'ContractInteraction' as SemanticActionType,
          protocol: labelAddr(e.contract),
          callId: state.callTree.id,
          description: `${e.operation || 'Contract call'} on ${labelAddr(e.contract)}${Number(e.tonAttached) > 0 ? ` with ${fmtTon} TON` : ''}`,
          involvedTokens: Number(e.tonAttached) > 0 ? ['TON'] : [],
          involvedAddresses: [e.executor, e.contract],
        });
      }
    }
  }

  // ─── Fallback: heuristic detection from call tree ─────────────────────────
  if (actions.length === 0) {
    for (const call of allCalls) {
      const addr = call.callee;

      // Swap detection — known DEX contracts
      if (TON_DEX_CONTRACTS.has(addr)) {
        const tokenSymbols = state.tokenFlows
          .filter(f => f.type === 'Transfer')
          .map(f => f.tokenSymbol);
        actions.push({
          type: 'Swap',
          protocol: call.contractName ?? lookupTonContractName(addr) ?? addr.slice(0, 12),
          callId: call.id,
          description: `Token swap via ${call.contractName ?? addr.slice(0, 16)}`,
          involvedTokens: [...new Set(tokenSymbols)],
          involvedAddresses: [call.caller, call.callee],
        });
        continue;
      }

      // Bridge detection
      if (TON_BRIDGE_CONTRACTS.has(addr)) {
        actions.push({
          type: 'Bridge',
          protocol: call.contractName ?? lookupTonContractName(addr) ?? addr.slice(0, 12),
          callId: call.id,
          description: `Cross-chain bridge via ${call.contractName ?? addr.slice(0, 16)}`,
          involvedTokens: [],
          involvedAddresses: [call.caller, call.callee],
        });
        continue;
      }
    }
  }

  // ─── Generic transfer fallback ────────────────────────────────────────────
  if (actions.length === 0 && state.tokenFlows.length > 0) {
    const symbols = [...new Set(state.tokenFlows.map(f => f.tokenSymbol))];
    actions.push({
      type: 'Transfer',
      protocol: symbols.includes('TON') ? 'TON' : 'Jetton',
      callId: state.callTree.id,
      description: `Transfer of ${symbols.join(', ')}`,
      involvedTokens: symbols,
      involvedAddresses: [...new Set(state.tokenFlows.flatMap(f => [f.from, f.to]))],
    });
  }

  return actions;
}

/** Format a raw token amount with decimals */
function formatAmount(raw: string, decimals: number): string {
  return (Number(BigInt(raw)) / Math.pow(10, decimals))
    .toFixed(Math.min(decimals, 6))
    .replace(/\.?0+$/, '');
}

// Standard TON VM exit codes
const STANDARD_EXIT_CODES: Record<number, string> = {
  0: 'Success',
  1: 'Alternative success',
  2: 'Stack underflow',
  3: 'Stack overflow',
  4: 'Integer overflow',
  5: 'Integer out of range',
  6: 'Invalid opcode',
  7: 'Type check error',
  8: 'Cell overflow',
  9: 'Cell underflow',
  10: 'Dictionary error',
  11: 'Unknown error',
  12: 'Fatal error',
  13: 'Out of gas',
  14: 'Virtualization error',
  32: 'Action list invalid',
  33: 'Action list too long',
  34: 'Action invalid or unsupported',
  35: 'Invalid source address in outbound message',
  36: 'Invalid destination address in outbound message',
  37: 'Not enough TON',
  38: 'Not enough extra currencies',
  39: 'Outbound message does not fit in a cell',
  40: 'Cannot process a message',
  41: 'Library not found',
  42: 'Library change actions error',
  43: 'Library limits exceeded',
  50: 'Account state size exceeded limits',
  [-14]: 'Not enough TON for gas',
};

function describeExitCode(exitCode: number): string {
  return STANDARD_EXIT_CODES[exitCode] ?? (exitCode >= 256
    ? `Custom contract error ${exitCode}`
    : `Unknown error ${exitCode}`);
}

/**
 * Analyze failures across the entire message tree, not just the root.
 * In TON, the root tx can succeed while child messages fail and bounce back.
 * Also checks event-level actions from TonAPI that may not appear in the trace.
 */
function analyzeTonFailure(state: TonAgentState): FailureReason | undefined {
  const allCalls = flattenCalls(state.callTree);

  // Find all failed calls (excluding bounces themselves, which are recovery)
  const failedCalls = allCalls.filter(c => !c.success && c.callType !== 'BOUNCE');
  // Find all bounce messages
  const bounces = allCalls.filter(c => c.callType === 'BOUNCE');
  // Failed event actions (may include failures not visible in the trace tree)
  const failedEventActions = (state.txData.eventActions ?? []).filter((a: TonEventAction) => a.status === 'failed');

  // Case 1: Root transaction itself failed
  if (!state.success) {
    const exitCode = state.exitCode;
    const standardMsg = describeExitCode(exitCode);
    let explanation: string;

    if (exitCode === 13 || exitCode === -14) {
      explanation = 'The transaction ran out of gas (TON). The compute budget was insufficient.';
    } else if (exitCode === 37) {
      explanation = 'The transaction failed because there was not enough TON to cover the operation and fees.';
    } else if (exitCode >= 256) {
      explanation = `The smart contract returned custom exit code ${exitCode}. This is a contract-specific error — check the contract source for details.`;
    } else {
      explanation = `The TON VM terminated with: "${standardMsg}" (exit code ${exitCode}).`;
    }

    return {
      rootCallId: state.callTree.id,
      reason: `exit_code ${exitCode}: ${standardMsg}`,
      explanation,
    };
  }

  // Case 2: Root succeeded but child messages failed (bounced)
  if (bounces.length > 0) {
    const failedDetails = failedCalls.map(c => {
      const exitMatch = c.revertReason?.match(/exit_code\s+(\d+)/);
      const code = exitMatch ? parseInt(exitMatch[1]) : null;
      const contract = c.contractName ?? c.callee.slice(0, 16) + '...';
      const fn = c.functionName ? `.${c.functionName}` : '';
      const codeDesc = code !== null ? `exit_code ${code} (${describeExitCode(code)})` : 'unknown error';
      return `${contract}${fn} failed with ${codeDesc}`;
    });

    const bouncedValue = bounces.reduce((sum, b) => {
      const v = BigInt(b.valueWei || '0');
      return sum + v;
    }, 0n);
    const bouncedTon = (Number(bouncedValue) / NANOTON).toFixed(4);

    const explanation = [
      `The root transaction succeeded, but ${bounces.length} sub-message(s) failed and bounced back.`,
      `Bounced value: ${bouncedTon} TON returned to sender.`,
      '',
      'Failed operations:',
      ...failedDetails.map(d => `• ${d}`),
      '',
      'In TON, a bounce means the destination contract rejected the message. Common causes:',
      '• Destination contract is uninitialized or frozen (no code deployed)',
      '• Insufficient Jetton balance in the wallet contract',
      '• Message body has wrong format or unexpected op-code',
      '• Contract-specific validation failed (e.g., wrong sender, expired deadline)',
      '• Attached TON insufficient for the forwarding fees the contract needs',
    ].join('\n');

    return {
      rootCallId: failedCalls[0]?.id ?? state.callTree.id,
      reason: `${bounces.length} bounced message(s) — partial failure`,
      explanation,
    };
  }

  // Case 3: Some child calls failed but no bounces (absorbed failures)
  if (failedCalls.length > 0) {
    const details = failedCalls.map(c => {
      const contract = c.contractName ?? c.callee.slice(0, 16) + '...';
      return `${contract} (${c.revertReason ?? 'unknown'})`;
    });

    return {
      rootCallId: failedCalls[0]!.id,
      reason: `${failedCalls.length} failed sub-operation(s)`,
      explanation: `The root transaction succeeded but ${failedCalls.length} child message(s) failed:\n${details.map(d => `• ${d}`).join('\n')}`,
    };
  }

  // Case 4: Event-level actions failed (not visible in trace tree)
  // TonAPI events can report failures for messages that never became transactions
  // (e.g., outbound messages that failed to deliver).
  if (failedEventActions.length > 0) {
    const details = failedEventActions.map((a: TonEventAction) => {
      const desc = a.description ?? `${a.type} action`;
      return `${a.type}: ${desc}`;
    });

    return {
      rootCallId: state.callTree.id,
      reason: `${failedEventActions.length} failed event action(s)`,
      explanation: [
        `The root transaction executed, but ${failedEventActions.length} action(s) in the trace event failed:`,
        ...details.map((d: string) => `• ${d}`),
        '',
        'These failures may not appear in the message trace tree because the outbound messages were never processed into transactions on the destination.',
      ].join('\n'),
    };
  }

  return undefined;
}

function detectTonRisks(state: TonAgentState): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const allCalls = flattenCalls(state.callTree);
  const names = state.txData.accountNames;
  const scam = state.txData.scamAddresses;

  const labelAddr = (addr: string) =>
    lookupTonContractName(addr) ?? names.get(addr) ?? addr.slice(0, 16) + '...';

  // ─── Scam addresses (from TonAPI is_scam) ─────────────────────────────────
  for (const addr of scam) {
    flags.push({
      level: 'high',
      type: 'SCAM_ADDRESS',
      description: `Address ${labelAddr(addr)} is flagged as SCAM by TonAPI. Interactions with this address are likely malicious.`,
    });
  }

  // ─── Large TON transfers (> 1000 TON) ─────────────────────────────────────
  const LARGE_TON_THRESHOLD = 1000 * NANOTON;
  for (const flow of state.tokenFlows) {
    if (flow.tokenSymbol === 'TON' && flow.type === 'NativeTransfer') {
      const amount = Number(flow.rawAmount);
      if (amount >= LARGE_TON_THRESHOLD) {
        flags.push({
          level: 'medium',
          type: 'LARGE_TON_TRANSFER',
          description: `Large TON transfer of ${flow.formattedAmount} TON from ${flow.from} to ${flow.to}`,
        });
      }
    }
  }

  // ─── Bounced messages (indicate failed sub-operations) ─────────────────────
  for (const call of allCalls) {
    if (call.callType === 'BOUNCE') {
      const failedCall = allCalls.find(c =>
        c.callee === call.caller && !c.success && c.callType === 'MESSAGE',
      );
      const failedFn = failedCall?.functionName ?? 'unknown operation';
      const exitMatch = failedCall?.revertReason?.match(/exit_code\s+(\d+)/);
      const exitCode = exitMatch ? parseInt(exitMatch[1]) : null;
      const exitDesc = exitCode !== null ? ` (exit_code ${exitCode}: ${describeExitCode(exitCode)})` : '';

      flags.push({
        level: 'medium',
        type: 'BOUNCED_MESSAGE',
        description: `Message to ${labelAddr(call.caller)} bounced: ${failedFn} failed${exitDesc}. The destination rejected the message and returned ${(Number(BigInt(call.valueWei || '0')) / NANOTON).toFixed(4)} TON.`,
        callId: call.id,
      });
    }
  }

  // ─── Failed event actions (not in trace tree) ─────────────────────────────
  for (const action of state.txData.eventActions ?? []) {
    if (action.status === 'failed') {
      // FlawedJettonTransfer is a special TonAPI action type for partial failures
      if (action.type === 'FlawedJettonTransfer') {
        flags.push({
          level: 'medium',
          type: 'FLAWED_JETTON_TRANSFER',
          description: `Flawed Jetton transfer detected: ${action.description ?? 'sent and received amounts differ — tokens may have been partially lost or diverted'}`,
        });
      }
    }
  }

  // ─── Unknown contracts ────────────────────────────────────────────────────
  const jettonWalletAddresses = new Set(
    state.txData.jettonTransfers.flatMap((jt: { senderAddress: string; recipientAddress: string }) => [jt.senderAddress, jt.recipientAddress]),
  );
  for (const call of allCalls) {
    if (
      call.callType === 'MESSAGE' &&
      !lookupTonContractName(call.callee) &&
      !names.has(call.callee) &&
      call.callee !== state.account &&
      !jettonWalletAddresses.has(call.callee)
    ) {
      flags.push({
        level: 'low',
        type: 'UNKNOWN_CONTRACT',
        description: `Interaction with unrecognized contract ${call.callee.slice(0, 16)}...`,
        callId: call.id,
      });
    }
  }

  // ─── Deep message chains (> 5 levels) ─────────────────────────────────────
  function maxDepth(node: NormalizedCall): number {
    if (node.children.length === 0) return node.depth;
    return Math.max(...node.children.map(maxDepth));
  }
  const depth = maxDepth(state.callTree);
  if (depth > 5) {
    flags.push({
      level: 'medium',
      type: 'DEEP_MESSAGE_CHAIN',
      description: `Transaction spawns a ${depth}-level deep message chain, indicating complex multi-contract interaction.`,
    });
  }

  return flags;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const TON_SYSTEM_PROMPT = `You are an expert TON (The Open Network) blockchain transaction analyst.

Key TON concepts:
- TON uses an **asynchronous message-passing model**. A transaction processes one inbound message and can emit multiple outbound messages. Each outbound message triggers a new transaction on the destination account.
- The full execution of a user action is called a **trace** — a tree of transactions connected by messages.
- **Bounce**: if a message has bounce=true and the destination contract fails (non-zero exit code), a bounce message is sent back to the sender with remaining value. A bounced message means the destination REJECTED the incoming message. The root tx can succeed while child messages bounce.
- **Jettons** are TON's fungible token standard (TEP-74), similar to ERC-20. Transfers involve multiple messages: wallet→sender_jetton_wallet→recipient_jetton_wallet→recipient. Each Jetton has a master contract and per-user wallet contracts.
- **TON** is the native currency (9 decimals, denominated in nanoTON: 1 TON = 1,000,000,000 nanoTON).
- Addresses are in workchain:hex format (e.g., 0:abc...) or user-friendly format (e.g., EQAbc...).
- **Exit codes**: 0 or 1 = success in compute phase. But a tx can still fail in the action phase (e.g., no_funds=true). Standard VM errors: 2-50. Custom contract errors: 256+.
- **Op-codes**: 32-bit operation identifiers in the message body determine which function a contract executes.
- Major DEXes: **Ston.fi** and **DeDust** (like Uniswap for TON).
- **Gas** in TON is paid in TON itself. Fees include compute, storage, and forward fees for messages.

Common bounce/failure reasons you MUST consider:
1. **Uninitialized contract**: destination account has no code deployed — the message bounces because there is nothing to execute.
2. **Insufficient Jetton balance**: the sender's Jetton wallet doesn't have enough tokens.
3. **Wrong Jetton wallet address**: the sender sent to an address that is not a valid Jetton wallet for that token, or the wallet belongs to a different owner.
4. **Insufficient attached TON**: the message didn't carry enough TON to cover forward fees for all subsequent messages in the Jetton transfer chain.
5. **Contract validation error**: the contract's own logic rejected the operation (custom exit code ≥256).
6. **Expired or invalid payload**: deadline passed, wrong query_id, or malformed message body.

When analyzing bounced messages, explain the MOST LIKELY root cause based on the specific exit code, the op-code, and the context of the trace.

You are provided with pre-analyzed context below. Use it to write your analysis directly.
Do NOT mention tools in your answer. Use human-readable names where provided instead of raw addresses.

Final answer format:
**Summary**: (2-3 sentences describing what happened — clearly state if there were partial failures)
**Step-by-step**: (numbered list of what occurred in order, following the message chain)
**Token flows**: (omit this section entirely if there are none)
**Risks**: (omit this section entirely if no risk flags were found)
**Failure analysis**: (include this section if ANY message in the trace bounced or failed, even if root succeeded. Explain the most likely cause of each failure.)

IMPORTANT: At the very end of your response, output an address labels block. For EVERY address that appears in the transaction, assign a human-readable role label. Use known contract/protocol names when available (e.g. "Ston.fi Router", "DeDust Vault", "USDT Jetton Master"). For unknown addresses, assign a descriptive role based on what they did (e.g. "Swapper (sender)", "Liquidity Pool", "Fee Receiver", "Jetton Wallet (sender)", "Jetton Wallet (recipient)"). Format:
\`\`\`address_labels
{"0:abc...full_address": "Role Label", "EQxyz...full_address": "Another Label"}
\`\`\``;

function buildTonInitialMessage(
  state: TonAgentState,
  preAnalyzed: {
    callTreeText: string;
    tokenFlowsText: string;
    failureText: string;
    actionsText: string;
    risksText: string;
    eventActionsText: string;
    txtracerText: string;
    sourceText: string;
  },
): string {
  const status = state.success ? 'SUCCESS ✅' : 'FAILED ❌';
  const hasBounces = flattenCalls(state.callTree).some(c => c.callType === 'BOUNCE');
  const hasFailedEventActions = (state.txData.eventActions ?? []).some((a: TonEventAction) => a.status === 'failed');
  const statusNote = state.success && (hasBounces || hasFailedEventActions)
    ? 'PARTIAL FAILURE ⚠️ (root tx succeeded but some actions failed)'
    : status;
  const network = state.networkId === 'ton-testnet' ? 'TON Testnet' : 'TON Mainnet';
  const feeFormatted = (Number(state.fee) / NANOTON).toFixed(9);
  const time = new Date(state.utime * 1000).toISOString();

  return `Analyze this TON transaction:

Hash: ${state.txHash}
Network: ${network}
Status: ${statusNote}
Account: ${state.account}
Exit code: ${state.exitCode}
Fee: ${feeFormatted} TON
Logical time: ${state.lt}
Timestamp: ${time}

## Pre-analyzed context (do NOT re-call these tools)

### Message trace tree
${preAnalyzed.callTreeText}

### Token flows
${preAnalyzed.tokenFlowsText}

### Failure analysis
${preAnalyzed.failureText}

### Detected actions
${preAnalyzed.actionsText}

### Risk flags
${preAnalyzed.risksText}

### Event actions (from TonAPI)
${preAnalyzed.eventActionsText}

${preAnalyzed.txtracerText}

${preAnalyzed.sourceText}

Write your final analysis directly based on the context above. If there are bounced messages, you MUST explain WHY they bounced. If contract source code is provided, reference the specific code that caused the failure.`;
}

// ─── Log writer ─────────────────────────────────────────────────────────────

async function saveTonAgentLog(
  txHash: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<void> {
  try {
    await mkdir(LOGS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const short = txHash.slice(0, 10);
    const assistantTurns = messages.filter(m => m.role === 'assistant').length;

    const lines: string[] = [
      '═'.repeat(80),
      `HASH:      ${txHash}`,
      `TIMESTAMP: ${new Date().toISOString()}`,
      `MODEL:     ${config.openrouter.model}`,
      `TURNS:     ${assistantTurns}`,
      '═'.repeat(80),
      '',
    ];

    for (const msg of messages) {
      if (msg.role === 'system') {
        lines.push('─── SYSTEM ───', typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content), '');
      } else if (msg.role === 'user') {
        lines.push('─── USER ───', typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content), '');
      } else if (msg.role === 'assistant') {
        const a = msg as OpenAI.Chat.ChatCompletionAssistantMessageParam;
        lines.push('─── ASSISTANT (FINAL) ───', typeof a.content === 'string' ? a.content : '', '');
      }
    }

    await writeFile(resolve(LOGS_DIR, `${ts}_ton_${short}.txt`), lines.join('\n'), 'utf8');
  } catch (err) {
    console.warn('[ton-agent] Failed to write log:', err);
  }
}

// ─── Progress events ─────────────────────────────────────────────────────────

export interface AgentProgressEvent {
  type: 'tool_call' | 'tool_result' | 'final_answer';
  turn: number;
  toolNames?: string[];
  toolName?: string;
  summary?: string;
}

export type ProgressCallback = (event: AgentProgressEvent) => void;

// ─── Agent loop ─────────────────────────────────────────────────────────────

export async function runTonAnalysisAgent(
  state: TonAgentState,
  onProgress?: ProgressCallback,
): Promise<TonAgentState & { llmExplanation: string; llmAddressLabels: Record<string, string> }> {
  const openai = getOpenAI();

  // ─── Pre-execute deterministic tools ────────────────────────────────────────

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['get_message_tree'] });
  const callTreeText = buildTonCallTreeText(state.callTree).join('\n');
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'get_message_tree', summary: callTreeText.split('\n')[0]?.slice(0, 120) ?? '' });

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['extract_token_flows'] });
  const tokenFlows = extractTonTokenFlows(state.txData);
  state.tokenFlows = tokenFlows;
  const tokenFlowsText = tokenFlows.length
    ? tokenFlows.map(f => `${f.type}: ${f.formattedAmount} ${f.tokenSymbol} from ${f.from.slice(0, 12)}... to ${f.to.slice(0, 12)}...`).join('\n')
    : 'None';
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'extract_token_flows', summary: tokenFlowsText.split('\n')[0]?.slice(0, 120) ?? '' });

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['analyze_failure'] });
  const failure = analyzeTonFailure(state);
  state.failureReason = failure;
  const failureText = failure
    ? `Error: "${failure.reason}"\nExplanation: ${failure.explanation}`
    : 'Transaction succeeded';
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'analyze_failure', summary: failureText.split('\n')[0]?.slice(0, 120) ?? '' });

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['detect_actions'] });
  const actions = detectTonActions(state);
  state.semanticActions = actions;
  const actionsText = actions.length
    ? actions.map(a => `${a.type}${a.protocol ? ` via ${a.protocol}` : ''}: ${a.description}`).join('\n')
    : 'None';
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'detect_actions', summary: actionsText.split('\n')[0]?.slice(0, 120) ?? '' });

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['detect_risks'] });
  const risks = detectTonRisks(state);
  state.riskFlags = risks;
  const risksText = risks.length
    ? risks.map(r => `[${r.level.toUpperCase()}] ${r.type}: ${r.description}`).join('\n')
    : 'None';
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'detect_risks', summary: risksText.split('\n')[0]?.slice(0, 120) ?? '' });

  // ─── Event actions (from TonAPI — may include failures not in trace) ─────────
  const eventActions = state.txData.eventActions ?? [];
  const eventActionsText = eventActions.length
    ? eventActions.map((a: TonEventAction) => {
        let detail = `${a.type}: status=${a.status}`;
        if (a.description) detail += ` — ${a.description}`;
        if (a.swap) detail += ` | DEX=${a.swap.dex} ${a.swap.symbolIn}→${a.swap.symbolOut}`;
        if (a.burn) detail += ` | burn ${a.burn.amount} ${a.burn.symbol ?? ''}`;
        if (a.mint) detail += ` | mint ${a.mint.amount} ${a.mint.symbol ?? ''}`;
        if (a.deploy) detail += ` | interfaces: ${a.deploy.interfaces.join(', ')}`;
        if (a.stake) detail += ` | pool=${a.stake.pool.slice(0, 16)}...`;
        if (a.nftPurchase) detail += ` | price=${(Number(a.nftPurchase.price) / NANOTON).toFixed(4)} TON`;
        return detail;
      }).join('\n')
    : 'None';

  // ─── TxTracer (optional TVM-level re-execution) ─────────────────────────────
  // TxTracer needs the actual transaction hash from TonCenter (not the trace hash).
  // The root transaction hash is in txData.trace.transaction.hash.
  const rootTxHash = state.txData.trace.transaction.hash;
  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['txtracer_retrace'] });
  let txtracerText = '';
  try {
    const txtraceResult = await traceTonTransaction(rootTxHash, state.networkId);
    txtracerText = formatTxTracerForPrompt(txtraceResult);
  } catch {
    txtracerText = 'TxTracer: not available (optional enrichment)';
  }
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'txtracer_retrace', summary: txtracerText.split('\n')[0]?.slice(0, 120) ?? '' });

  // ─── Contract source resolution (for failed/key contracts) ──────────────────
  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['resolve_contract_source'] });
  let sourceText = '';
  try {
    // Resolve source for contracts involved in failures (most useful for debugging)
    const allCalls = flattenCalls(state.callTree);
    const failedAddresses = new Set<string>();

    // Add addresses of failed calls (the contracts that rejected messages)
    for (const call of allCalls) {
      if (!call.success && call.callType !== 'BOUNCE') {
        failedAddresses.add(call.callee);
      }
    }

    // If no failures, resolve the main contract
    if (failedAddresses.size === 0) {
      failedAddresses.add(state.account);
    }

    // Resolve up to 2 contracts to keep latency reasonable
    const addressesToResolve = [...failedAddresses].slice(0, 2);
    const sourceResults = await Promise.all(
      addressesToResolve.map(addr => resolveContractSource(addr, state.networkId)),
    );

    const sourceParts: string[] = [];
    for (let i = 0; i < addressesToResolve.length; i++) {
      const result = sourceResults[i];
      if (result) {
        sourceParts.push(formatSourceForPrompt(result, addressesToResolve[i]!));
      }
    }
    sourceText = sourceParts.join('\n\n');
  } catch {
    sourceText = '';
  }
  const sourceSummary = sourceText
    ? sourceText.includes('verified') ? 'Verified source found' : 'Decompiled assembly available'
    : 'No source available';
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'resolve_contract_source', summary: sourceSummary });

  // ─── LLM call (no optional tools for TON — all context is pre-analyzed) ───

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: TON_SYSTEM_PROMPT },
    { role: 'user', content: buildTonInitialMessage(state, { callTreeText, tokenFlowsText, failureText, actionsText, risksText, eventActionsText, txtracerText, sourceText }) },
  ];

  let llmExplanation = 'Analysis could not be completed.';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: config.openrouter.model,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    });

    const msg = response.choices[0]?.message;
    if (!msg) break;

    messages.push(msg as OpenAI.Chat.ChatCompletionMessageParam);

    llmExplanation = msg.content ?? llmExplanation;
    onProgress?.({ type: 'final_answer', turn: turn + 1 });
    break;
  }

  await saveTonAgentLog(state.txHash, messages);

  const parsed = parseAddressLabels(llmExplanation);
  return { ...state, llmExplanation: parsed.explanation, llmAddressLabels: parsed.labels };
}
