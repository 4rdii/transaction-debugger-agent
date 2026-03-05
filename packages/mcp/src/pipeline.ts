/**
 * Thin wrappers around backend services for the MCP server.
 * Imports backend code directly — no HTTP calls needed.
 */

import { fetchTxParams } from '../../backend/src/services/ethers.service.js';
import { simulateTransaction } from '../../backend/src/services/tenderly.service.js';
import { normalizeCallTrace } from '../../backend/src/services/normalizer.service.js';
import { extractTokenFlows } from '../../backend/src/services/tokenflow.service.js';
import { detectSemanticActions } from '../../backend/src/services/action.service.js';
import { analyzeFailure } from '../../backend/src/services/failure.service.js';
import { detectRisks } from '../../backend/src/services/risk.service.js';
import { runAnalysisAgent } from '../../backend/src/services/agent.service.js';
import { getCached, setCached } from '../../backend/src/services/cache.service.js';
import { isSolanaNetwork } from '../../backend/src/config.js';
import { fetchSolanaTransaction } from '../../backend/src/services/solana-rpc.service.js';
import { normalizeSolanaTransaction } from '../../backend/src/services/solana-normalizer.service.js';
import { extractSolanaTokenFlows } from '../../backend/src/services/solana-tokenflow.service.js';
import { runSolanaAnalysisAgent } from '../../backend/src/services/solana-agent.service.js';
import { resolveRangoSwap } from '../../backend/src/services/rango.service.js';
import type { AnalysisResult, NormalizedCall, TokenFlow, RiskFlag, SemanticAction, FailureReason } from '@debugger/shared';

// Re-export for tools.ts
export { resolveRangoSwap };

// ── Full debug pipeline ──────────────────────────────────────────────

async function runEvmPipeline(
  txHash: string,
  networkId: string,
): Promise<AnalysisResult> {
  const cached = getCached(txHash, networkId);
  if (cached) return cached;

  const txParams = await fetchTxParams(txHash, networkId);
  const simulation = await simulateTransaction(txParams, networkId);
  const txInfo = simulation.transaction.transaction_info;
  const callTree = normalizeCallTrace(txInfo.call_trace);

  const agentResult = await runAnalysisAgent({
    txHash,
    networkId: Number(networkId),
    success: txParams.onChainStatus,
    gasUsed: txParams.gasUsed,
    blockNumber: txParams.blockNumber,
    callTree,
    simulation,
    txParams,
    tokenFlows: [],
    semanticActions: [],
    riskFlags: [],
    failureReason: undefined,
  });

  const result: AnalysisResult = {
    txHash,
    networkId,
    success: agentResult.success,
    gasUsed: agentResult.gasUsed,
    blockNumber: agentResult.blockNumber,
    callTree: agentResult.callTree,
    tokenFlows: agentResult.tokenFlows,
    semanticActions: agentResult.semanticActions,
    riskFlags: agentResult.riskFlags,
    failureReason: agentResult.failureReason,
    llmExplanation: agentResult.llmExplanation,
    analyzedAt: new Date().toISOString(),
  };

  setCached(txHash, networkId, result);
  return result;
}

async function runSolanaPipeline(
  txHash: string,
  networkId: string,
): Promise<AnalysisResult> {
  const cached = getCached(txHash, networkId);
  if (cached) return cached;

  const txData = await fetchSolanaTransaction(txHash, networkId);
  const callTree = normalizeSolanaTransaction(txData);

  const agentResult = await runSolanaAnalysisAgent({
    signature: txHash,
    networkId,
    success: txData.success,
    computeUnitsConsumed: txData.computeUnitsConsumed,
    slot: txData.slot,
    fee: txData.fee,
    callTree,
    txData,
    tokenFlows: [],
    semanticActions: [],
    riskFlags: [],
    failureReason: undefined,
  });

  const result: AnalysisResult = {
    txHash,
    networkId,
    success: agentResult.success,
    gasUsed: agentResult.computeUnitsConsumed,
    blockNumber: agentResult.slot,
    callTree: agentResult.callTree,
    tokenFlows: agentResult.tokenFlows,
    semanticActions: agentResult.semanticActions,
    riskFlags: agentResult.riskFlags,
    failureReason: agentResult.failureReason,
    llmExplanation: agentResult.llmExplanation,
    analyzedAt: new Date().toISOString(),
  };

  setCached(txHash, networkId, result);
  return result;
}

export async function debugTransaction(
  txHash: string,
  networkId: string,
): Promise<AnalysisResult> {
  if (isSolanaNetwork(networkId)) {
    return runSolanaPipeline(txHash, networkId);
  }
  return runEvmPipeline(txHash, networkId);
}

// ── No-LLM debug: returns structured data for Claude Code to analyze ─

export interface DebugData {
  txHash: string;
  networkId: string;
  success: boolean;
  gasUsed: number;
  blockNumber: number;
  callTree: NormalizedCall;
  tokenFlows: TokenFlow[];
  semanticActions: SemanticAction[];
  riskFlags: RiskFlag[];
  failureReason: FailureReason | undefined;
}

async function runEvmPipelineNoLLM(
  txHash: string,
  networkId: string,
): Promise<DebugData> {
  const txParams = await fetchTxParams(txHash, networkId);
  const simulation = await simulateTransaction(txParams, networkId);
  const txInfo = simulation.transaction.transaction_info;
  const callTree = normalizeCallTrace(txInfo.call_trace);
  const tokenFlows = extractTokenFlows(txInfo.asset_changes, txInfo.balance_diff);
  const semanticActions = detectSemanticActions(callTree, tokenFlows);
  const failureReason = txParams.onChainStatus ? undefined : analyzeFailure(callTree);
  const riskFlags = detectRisks(callTree, tokenFlows, semanticActions);

  return {
    txHash,
    networkId,
    success: txParams.onChainStatus,
    gasUsed: txParams.gasUsed,
    blockNumber: txParams.blockNumber,
    callTree,
    tokenFlows,
    semanticActions,
    riskFlags,
    failureReason,
  };
}

async function runSolanaPipelineNoLLM(
  txHash: string,
  networkId: string,
): Promise<DebugData> {
  const txData = await fetchSolanaTransaction(txHash, networkId);
  const callTree = normalizeSolanaTransaction(txData);
  const tokenFlows = extractSolanaTokenFlows(txData);
  const semanticActions = detectSemanticActions(callTree, tokenFlows);
  const failureReason = txData.success ? undefined : analyzeFailure(callTree);
  const riskFlags = detectRisks(callTree, tokenFlows, semanticActions);

  return {
    txHash,
    networkId,
    success: txData.success,
    gasUsed: txData.computeUnitsConsumed,
    blockNumber: txData.slot,
    callTree,
    tokenFlows,
    semanticActions,
    riskFlags,
    failureReason,
  };
}

export async function debugTransactionNoLLM(
  txHash: string,
  networkId: string,
): Promise<DebugData> {
  if (isSolanaNetwork(networkId)) {
    return runSolanaPipelineNoLLM(txHash, networkId);
  }
  return runEvmPipelineNoLLM(txHash, networkId);
}

// ── Granular: call tree only (no LLM) ────────────────────────────────

export async function getCallTree(
  txHash: string,
  networkId: string,
): Promise<NormalizedCall> {
  if (isSolanaNetwork(networkId)) {
    const txData = await fetchSolanaTransaction(txHash, networkId);
    return normalizeSolanaTransaction(txData);
  }

  const txParams = await fetchTxParams(txHash, networkId);
  const simulation = await simulateTransaction(txParams, networkId);
  return normalizeCallTrace(simulation.transaction.transaction_info.call_trace);
}

// ── Granular: token flows only ───────────────────────────────────────

export async function getTokenFlows(
  txHash: string,
  networkId: string,
): Promise<TokenFlow[]> {
  if (isSolanaNetwork(networkId)) {
    // Solana token flows require full agent analysis
    const result = await debugTransaction(txHash, networkId);
    return result.tokenFlows;
  }

  const txParams = await fetchTxParams(txHash, networkId);
  const simulation = await simulateTransaction(txParams, networkId);
  const txInfo = simulation.transaction.transaction_info;
  return extractTokenFlows(txInfo.asset_changes, txInfo.balance_diff);
}

// ── Granular: risk flags only ────────────────────────────────────────

export async function getRiskFlags(
  txHash: string,
  networkId: string,
): Promise<RiskFlag[]> {
  if (isSolanaNetwork(networkId)) {
    const result = await debugTransaction(txHash, networkId);
    return result.riskFlags;
  }

  const txParams = await fetchTxParams(txHash, networkId);
  const simulation = await simulateTransaction(txParams, networkId);
  const txInfo = simulation.transaction.transaction_info;
  const callTree = normalizeCallTrace(txInfo.call_trace);
  const tokenFlows = extractTokenFlows(txInfo.asset_changes, txInfo.balance_diff);
  return detectRisks(callTree, tokenFlows, []);
}
