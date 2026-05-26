/**
 * MCP-specific backend routes.
 * These endpoints run the debug pipeline WITHOUT an LLM — raw structured data only.
 * Used by the rango-transaction-debugger MCP server (mcp.debazaar.click).
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { isSolanaNetwork, isTonNetwork } from '../config.js';

// EVM services
import { fetchTxParams } from '../services/ethers.service.js';
import { fetchTransactionTrace, simulateTransaction } from '../services/tenderly.service.js';
import { normalizeCallTrace } from '../services/normalizer.service.js';
import { extractTokenFlows } from '../services/tokenflow.service.js';
import { detectSemanticActions } from '../services/action.service.js';
import { analyzeFailure } from '../services/failure.service.js';
import { detectRisks } from '../services/risk.service.js';
import { getContractAbi, getContractSource } from '../services/etherscan.service.js';
import { castCall, castRun } from '../services/foundry.service.js';
import { simulateWithFix } from '../services/simulate-fix.service.js';

// Solana services
import { fetchSolanaTransaction } from '../services/solana-rpc.service.js';
import { normalizeSolanaTransaction } from '../services/solana-normalizer.service.js';
import { extractSolanaTokenFlows } from '../services/solana-tokenflow.service.js';

// TON services
import { fetchTonTransaction } from '../services/ton-rpc.service.js';
import { normalizeTonTransaction } from '../services/ton-normalizer.service.js';
import { extractTonTokenFlows } from '../services/ton-tokenflow.service.js';

import type { NormalizedCall } from '@debugger/shared';

export const mcpRouter = Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

function findCallById(node: NormalizedCall, id: string): NormalizedCall | undefined {
  if ((node as any).id === id) return node;
  for (const child of node.children ?? []) {
    const found = findCallById(child, id);
    if (found) return found;
  }
  return undefined;
}

// ── POST /raw — full NoLLM debug pipeline ────────────────────────────────────

mcpRouter.post('/raw', async (req: Request, res: Response, next: NextFunction) => {
  const { txHash, networkId } = req.body as { txHash?: string; networkId?: string };
  if (!txHash || !networkId) {
    res.status(400).json({ error: 'txHash and networkId are required' });
    return;
  }

  try {
    let result: object;

    if (isSolanaNetwork(networkId)) {
      const txData = await fetchSolanaTransaction(txHash, networkId);
      const callTree = normalizeSolanaTransaction(txData);
      const tokenFlows = extractSolanaTokenFlows(txData);
      const semanticActions = detectSemanticActions(callTree, tokenFlows);
      const failureReason = txData.success ? undefined : analyzeFailure(callTree);
      const riskFlags = detectRisks(callTree, tokenFlows, semanticActions);
      result = { txHash, networkId, success: txData.success, gasUsed: txData.computeUnitsConsumed, blockNumber: txData.slot, callTree, tokenFlows, semanticActions, riskFlags, failureReason };
    } else if (isTonNetwork(networkId)) {
      const txData = await fetchTonTransaction(txHash, networkId);
      const callTree = normalizeTonTransaction(txData);
      const tokenFlows = extractTonTokenFlows(txData);
      const semanticActions = detectSemanticActions(callTree, tokenFlows);
      const failureReason = txData.success ? undefined : analyzeFailure(callTree);
      const riskFlags = detectRisks(callTree, tokenFlows, semanticActions);
      result = { txHash, networkId, success: txData.success, gasUsed: Number(txData.fee), blockNumber: Number(txData.lt), callTree, tokenFlows, semanticActions, riskFlags, failureReason };
    } else {
      const txParams = await fetchTxParams(txHash, networkId);

      // Try the direct trace endpoint first — it uses actual on-chain execution data
      // (more accurate decoded params, labels, logs). Fall back to simulation if not indexed.
      let txInfo: import('@debugger/shared').TenderlyTransactionInfo;
      const tracedTx = await fetchTransactionTrace(txHash, networkId);
      if (tracedTx) {
        txInfo = tracedTx.transaction_info;
      } else {
        const simulation = await simulateTransaction(txParams, networkId);
        txInfo = simulation.transaction.transaction_info;
      }

      const callTree = normalizeCallTrace(txInfo.call_trace);
      const tokenFlows = extractTokenFlows(txInfo.asset_changes, txInfo.balance_diff);
      const semanticActions = detectSemanticActions(callTree, tokenFlows);
      const failureReason = txParams.onChainStatus ? undefined : analyzeFailure(callTree);
      const riskFlags = detectRisks(callTree, tokenFlows, semanticActions);
      result = { txHash, networkId, success: txParams.onChainStatus, gasUsed: txParams.gasUsed, blockNumber: txParams.blockNumber, callTree, tokenFlows, semanticActions, riskFlags, failureReason, stackTrace: txInfo.stack_trace ?? [] };
    }

    res.json({ result });
  } catch (err) {
    next(err);
  }
});

// ── POST /call-subtree — drill into a specific call node ─────────────────────

mcpRouter.post('/call-subtree', async (req: Request, res: Response, next: NextFunction) => {
  const { txHash, networkId, callId } = req.body as { txHash?: string; networkId?: string; callId?: string };
  if (!txHash || !networkId || !callId) {
    res.status(400).json({ error: 'txHash, networkId and callId are required' });
    return;
  }

  try {
    let callTree: NormalizedCall;
    if (isSolanaNetwork(networkId)) {
      const txData = await fetchSolanaTransaction(txHash, networkId);
      callTree = normalizeSolanaTransaction(txData);
    } else if (isTonNetwork(networkId)) {
      const txData = await fetchTonTransaction(txHash, networkId);
      callTree = normalizeTonTransaction(txData);
    } else {
      const txParams = await fetchTxParams(txHash, networkId);
      const tracedTx = await fetchTransactionTrace(txHash, networkId);
      const traceData = tracedTx
        ? tracedTx.transaction_info
        : (await simulateTransaction(txParams, networkId)).transaction.transaction_info;
      callTree = normalizeCallTrace(traceData.call_trace);
    }

    const node = findCallById(callTree, callId);
    if (!node) {
      res.status(404).json({ error: `No call found with id "${callId}"` });
      return;
    }
    res.json({ subtree: node });
  } catch (err) {
    next(err);
  }
});

// ── POST /contract-abi — fetch verified ABI ──────────────────────────────────

mcpRouter.post('/contract-abi', async (req: Request, res: Response, next: NextFunction) => {
  const { address, networkId } = req.body as { address?: string; networkId?: string | number };
  if (!address || !networkId) {
    res.status(400).json({ error: 'address and networkId are required' });
    return;
  }
  try {
    const abi = await getContractAbi(address, Number(networkId));
    res.json({ abi });
  } catch (err) {
    next(err);
  }
});

// ── POST /revert-source — fetch Solidity source + locate function ─────────────

mcpRouter.post('/revert-source', async (req: Request, res: Response, next: NextFunction) => {
  const { address, networkId, functionName } = req.body as { address?: string; networkId?: string | number; functionName?: string };
  if (!address || !networkId || !functionName) {
    res.status(400).json({ error: 'address, networkId and functionName are required' });
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(400).json({ error: `"${address}" is not a valid 42-character Ethereum address` });
    return;
  }
  try {
    const sourceResult = await getContractSource(address, Number(networkId));
    if (typeof sourceResult === 'string') {
      res.json({ error: sourceResult });
      return;
    }

    const pattern = new RegExp(
      `\\bfunction\\s+${functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`,
    );
    const matchingFiles = sourceResult.files.filter(f => pattern.test(f.content));

    res.json({
      contractName: sourceResult.contractName,
      compilerVersion: sourceResult.compilerVersion,
      totalFiles: sourceResult.files.length,
      matchingFiles: matchingFiles.map(f => ({ name: f.name, content: f.content })),
      allFileNames: matchingFiles.length === 0 ? sourceResult.files.map(f => f.name) : undefined,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /cast-call — static on-chain call at a specific block ───────────────

mcpRouter.post('/cast-call', async (req: Request, res: Response, next: NextFunction) => {
  const { address, functionSignature, args, networkId, blockNumber } = req.body as {
    address?: string;
    functionSignature?: string;
    args?: string[];
    networkId?: string | number;
    blockNumber?: number;
  };
  if (!address || !functionSignature || !networkId || blockNumber === undefined) {
    res.status(400).json({ error: 'address, functionSignature, networkId and blockNumber are required' });
    return;
  }
  try {
    const result = await castCall(address, functionSignature, args ?? [], Number(networkId), blockNumber);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

// ── POST /cast-run — opcode-level Foundry replay ─────────────────────────────

mcpRouter.post('/cast-run', async (req: Request, res: Response, next: NextFunction) => {
  const { txHash, networkId } = req.body as { txHash?: string; networkId?: string | number };
  if (!txHash || !networkId) {
    res.status(400).json({ error: 'txHash and networkId are required' });
    return;
  }
  try {
    const result = await castRun(txHash, Number(networkId));
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

// ── POST /simulate-fix — re-simulate with a fix applied ──────────────────────

mcpRouter.post('/simulate-fix', async (req: Request, res: Response, next: NextFunction) => {
  const { txHash, networkId, fix } = req.body as {
    txHash?: string;
    networkId?: string;
    fix?: {
      type: 'increase_gas' | 'set_eth_balance' | 'set_erc20_allowance';
      multiplier?: number;
      amountEth?: number;
      tokenAddress?: string;
      spender?: string;
      mappingSlot?: number;
    };
  };

  if (!txHash || !networkId || !fix) {
    res.status(400).json({ error: 'txHash, networkId and fix are required' });
    return;
  }

  try {
    const txParams = await fetchTxParams(txHash, networkId);

    let fixArg: Parameters<typeof simulateWithFix>[2];
    if (fix.type === 'increase_gas') {
      fixArg = { type: 'increase_gas', multiplier: fix.multiplier };
    } else if (fix.type === 'set_eth_balance') {
      fixArg = { type: 'set_eth_balance', amountEth: fix.amountEth };
    } else {
      if (!fix.tokenAddress || !fix.spender) {
        res.status(400).json({ error: 'set_erc20_allowance requires tokenAddress and spender' });
        return;
      }
      fixArg = { type: 'set_erc20_allowance', tokenAddress: fix.tokenAddress, spender: fix.spender, mappingSlot: fix.mappingSlot };
    }

    const result = await simulateWithFix(txParams, networkId, fixArg);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});
