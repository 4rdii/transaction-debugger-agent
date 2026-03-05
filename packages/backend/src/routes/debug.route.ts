import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { validate, DebugRequestSchema } from '../middleware/validate.middleware.js';
import { fetchTxParams } from '../services/ethers.service.js';
import { simulateTransaction } from '../services/tenderly.service.js';
import { normalizeCallTrace } from '../services/normalizer.service.js';
import { runAnalysisAgent } from '../services/agent.service.js';
import type { AgentProgressEvent } from '../services/agent.service.js';
import { getCached, setCached } from '../services/cache.service.js';
import { isSolanaNetwork } from '../config.js';
import { fetchSolanaTransaction } from '../services/solana-rpc.service.js';
import { normalizeSolanaTransaction } from '../services/solana-normalizer.service.js';
import { runSolanaAnalysisAgent } from '../services/solana-agent.service.js';
import type { AnalysisResult } from '@debugger/shared';

export const debugRouter = Router();

// ─── Shared analysis pipeline ─────────────────────────────────────────────────

type StepCallback = (msg: string) => void;
type ProgressCallback = (event: AgentProgressEvent) => void;

async function runSolanaPipeline(
  txHash: string,
  networkId: string,
  onStep?: StepCallback,
  onAgentProgress?: ProgressCallback,
): Promise<AnalysisResult> {
  const cached = getCached(txHash, networkId);
  if (cached) {
    onStep?.('Loaded from cache.');
    return cached;
  }

  onStep?.('Fetching Solana transaction...');
  const txData = await fetchSolanaTransaction(txHash, networkId);

  onStep?.('Normalizing instruction tree...');
  const callTree = normalizeSolanaTransaction(txData);

  onStep?.('Starting Solana AI agent...');
  const agentResult = await runSolanaAnalysisAgent(
    {
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
    },
    onAgentProgress,
  );

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

async function runEvmPipeline(
  txHash: string,
  networkId: string,
  onStep?: StepCallback,
  onAgentProgress?: ProgressCallback,
): Promise<AnalysisResult> {
  const cached = getCached(txHash, networkId);
  if (cached) {
    onStep?.('Loaded from cache.');
    return cached;
  }

  onStep?.('Fetching transaction from RPC...');
  const txParams = await fetchTxParams(txHash, networkId);

  onStep?.('Simulating on Tenderly...');
  const simulation = await simulateTransaction(txParams, networkId);
  const txInfo = simulation.transaction.transaction_info;

  onStep?.('Normalizing call trace...');
  const callTree = normalizeCallTrace(txInfo.call_trace);

  onStep?.('Starting AI agent...');
  const agentResult = await runAnalysisAgent(
    {
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
    },
    onAgentProgress,
  );

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

async function runPipeline(
  txHash: string,
  networkId: string,
  onStep?: StepCallback,
  onAgentProgress?: ProgressCallback,
): Promise<AnalysisResult> {
  if (isSolanaNetwork(networkId)) {
    return runSolanaPipeline(txHash, networkId, onStep, onAgentProgress);
  }
  return runEvmPipeline(txHash, networkId, onStep, onAgentProgress);
}

// ─── SSE streaming endpoint ───────────────────────────────────────────────────

debugRouter.get('/stream', async (req: Request, res: Response) => {
  const { txHash, networkId } = req.query as { txHash?: string; networkId?: string };

  if (!txHash || !networkId) {
    res.status(400).json({ error: 'Missing txHash or networkId' });
    return;
  }

  // Validate format based on network type
  const isSolana = isSolanaNetwork(networkId);
  const isValidHash = isSolana
    ? /^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(txHash)
    : /^0x[0-9a-fA-F]{64}$/.test(txHash);

  if (!isValidHash) {
    res.status(400).json({ error: isSolana ? 'Invalid Solana signature' : 'Invalid transaction hash' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const result = await runPipeline(
      txHash,
      networkId,
      msg => send({ type: 'step', message: msg }),
      event => {
        if (event.type === 'tool_call') {
          send({ type: 'tool_call', turn: event.turn, toolNames: event.toolNames });
        } else if (event.type === 'tool_result') {
          send({ type: 'tool_result', turn: event.turn, toolName: event.toolName, summary: event.summary });
        } else if (event.type === 'final_answer') {
          send({ type: 'step', message: 'Writing final analysis...' });
        }
      },
    );

    send({ type: 'complete', result });
    res.end();
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    res.end();
  }
});

// ─── POST endpoint ────────────────────────────────────────────────────────────

debugRouter.post(
  '/',
  validate(DebugRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    const { txHash, networkId } = req.body as { txHash: string; networkId: string };

    try {
      console.log(`[debug] Analyzing tx ${txHash} on network ${networkId}`);
      const result = await runPipeline(txHash, networkId);
      res.json({ result });
    } catch (err) {
      next(err);
    }
  }
);
