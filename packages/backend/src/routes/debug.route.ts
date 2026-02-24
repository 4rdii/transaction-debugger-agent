import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { validate, DebugRequestSchema } from '../middleware/validate.middleware.js';
import { fetchTxParams } from '../services/ethers.service.js';
import { simulateTransaction } from '../services/tenderly.service.js';
import { normalizeCallTrace } from '../services/normalizer.service.js';
import { extractTokenFlows } from '../services/tokenflow.service.js';
import { detectSemanticActions } from '../services/action.service.js';
import { analyzeFailure } from '../services/failure.service.js';
import { detectRisks } from '../services/risk.service.js';
import { generateExplanation } from '../services/llm.service.js';
import { getCached, setCached } from '../services/cache.service.js';
import type { AnalysisResult } from '@debugger/shared';

export const debugRouter = Router();

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
      const tenderlyResponse = await simulateTransaction(txParams, networkId);
      const { transaction } = tenderlyResponse;
      const txInfo = transaction.transaction_info;

      // 3. Normalize call trace
      console.log('[debug] Normalizing call trace...');
      const callTree = normalizeCallTrace(txInfo.call_trace);

      // 4. Extract token flows
      console.log('[debug] Extracting token flows...');
      const tokenFlows = extractTokenFlows(txInfo.asset_changes, txInfo.balance_diff);

      // 5. Detect semantic actions
      console.log('[debug] Detecting semantic actions...');
      const semanticActions = detectSemanticActions(callTree, tokenFlows);

      // 6. Analyze failure (if any)
      const failureReason = transaction.status ? undefined : analyzeFailure(callTree);

      // 7. Detect risks
      console.log('[debug] Detecting risks...');
      const riskFlags = detectRisks(callTree, tokenFlows, semanticActions);

      // 8. Build partial result for LLM
      const partialResult: Omit<AnalysisResult, 'llmExplanation'> = {
        txHash,
        networkId,
        success: transaction.status,
        gasUsed: transaction.gas_used,
        blockNumber: transaction.block_number,
        callTree,
        tokenFlows,
        semanticActions,
        riskFlags,
        failureReason,
        analyzedAt: new Date().toISOString(),
      };

      // 9. Generate LLM explanation
      console.log('[debug] Generating LLM explanation...');
      const llmExplanation = await generateExplanation(partialResult);

      const result: AnalysisResult = { ...partialResult, llmExplanation };

      // Cache and return
      setCached(txHash, networkId, result);
      res.json({ result });
    } catch (err) {
      next(err);
    }
  }
);
