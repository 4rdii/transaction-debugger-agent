import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { validate, DebugRequestSchema } from '../middleware/validate.middleware.js';
import { fetchTxParams } from '../services/ethers.service.js';
import { simulateTransaction } from '../services/tenderly.service.js';
import { normalizeCallTrace } from '../services/normalizer.service.js';
import { runAnalysisAgent } from '../services/agent.service.js';
import type { AgentProgressEvent } from '../services/agent.service.js';
import { getCached, setCached } from '../services/cache.service.js';
import type { AnalysisResult } from '@debugger/shared';

export const debugRouter = Router();

// ─── SSE streaming endpoint ───────────────────────────────────────────────────

debugRouter.get('/stream', async (req: Request, res: Response) => {
  const { txHash, networkId } = req.query as { txHash?: string; networkId?: string };

  if (!txHash?.match(/^0x[0-9a-fA-F]{64}$/) || !networkId) {
    res.status(400).json({ error: 'Invalid txHash or networkId' });
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

  // Helper to convert agent events to SSE messages
  function onAgentProgress(event: AgentProgressEvent) {
    if (event.type === 'tool_call') {
      send({ type: 'tool_call', turn: event.turn, toolNames: event.toolNames });
    } else if (event.type === 'tool_result') {
      send({ type: 'tool_result', turn: event.turn, toolName: event.toolName, summary: event.summary });
    } else if (event.type === 'final_answer') {
      send({ type: 'step', message: 'Writing final analysis...' });
    }
  }

  try {
    // Cache hit — still stream a couple of steps for consistency
    const cached = getCached(txHash, networkId);
    if (cached) {
      send({ type: 'step', message: 'Loaded from cache.' });
      send({ type: 'complete', result: cached });
      res.end();
      return;
    }

    send({ type: 'step', message: 'Fetching transaction from RPC...' });
    const txParams = await fetchTxParams(txHash, networkId);

    send({ type: 'step', message: 'Simulating on Tenderly...' });
    const simulation = await simulateTransaction(txParams, networkId);
    const { transaction } = simulation;
    const txInfo = transaction.transaction_info;

    send({ type: 'step', message: 'Normalizing call trace...' });
    const callTree = normalizeCallTrace(txInfo.call_trace);

    send({ type: 'step', message: 'Starting AI agent...' });
    const agentResult = await runAnalysisAgent(
      {
        txHash,
        networkId: Number(networkId),
        success: transaction.status,
        gasUsed: transaction.gas_used,
        blockNumber: transaction.block_number,
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
    send({ type: 'complete', result });
    res.end();
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    res.end();
  }
});

// ─── POST endpoint (kept for backward compat) ─────────────────────────────────

debugRouter.post(
  '/',
  validate(DebugRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    const { txHash, networkId } = req.body as { txHash: string; networkId: string };

    // Cache hit
    const cached = getCached(txHash, networkId);
    if (cached) {
      res.json({ result: cached });
      return;
    }

    try {
      console.log(`[debug] Analyzing tx ${txHash} on network ${networkId}`);

      // 1. Fetch tx params from chain
      console.log('[debug] Fetching tx params from RPC...');
      const txParams = await fetchTxParams(txHash, networkId);

      // 2. Simulate on Tenderly for rich trace
      console.log('[debug] Simulating on Tenderly...');
      const simulation = await simulateTransaction(txParams, networkId);
      const { transaction } = simulation;
      const txInfo = transaction.transaction_info;

      // 3. Normalize call trace
      console.log('[debug] Normalizing call trace...');
      const callTree = normalizeCallTrace(txInfo.call_trace);

      // 4. Run agent (drives token flow, action, failure, risk analysis + LLM explanation)
      console.log('[debug] Running analysis agent...');
      const agentResult = await runAnalysisAgent({
        txHash,
        networkId: Number(networkId),
        success: transaction.status,
        gasUsed: transaction.gas_used,
        blockNumber: transaction.block_number,
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

      // Cache and return
      setCached(txHash, networkId, result);
      res.json({ result });
    } catch (err) {
      next(err);
    }
  }
);
