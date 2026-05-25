import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { ethers } from 'ethers';
import { validate, DebugRequestSchema } from '../middleware/validate.middleware.js';
import { fetchTxParams } from '../services/ethers.service.js';
import { simulateTransaction } from '../services/tenderly.service.js';
import { normalizeCallTrace } from '../services/normalizer.service.js';
import { runAnalysisAgent } from '../services/agent.service.js';
import { buildFallbackAnalysis } from '../services/fallback-analysis.service.js';
import type { RiskFlag } from '@debugger/shared';

/** Deduplicate risk flags by (type, callId) when merging agent output with fallback output. */
function mergeUniqueRiskFlags(a: RiskFlag[], b: RiskFlag[]): RiskFlag[] {
  const seen = new Set<string>();
  const out: RiskFlag[] = [];
  for (const rf of [...a, ...b]) {
    const key = `${rf.type}::${rf.callId ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(rf);
    }
  }
  return out;
}
import type { AgentProgressEvent } from '../services/agent.service.js';
import { getCached, setCached } from '../services/cache.service.js';
import { isSolanaNetwork, isTonNetwork, config } from '../config.js';
import { fetchSolanaTransaction } from '../services/solana-rpc.service.js';
import { normalizeSolanaTransaction } from '../services/solana-normalizer.service.js';
import { runSolanaAnalysisAgent } from '../services/solana-agent.service.js';
import { fetchTonTransaction } from '../services/ton-rpc.service.js';
import { normalizeTonTransaction } from '../services/ton-normalizer.service.js';
import { runTonAnalysisAgent } from '../services/ton-agent.service.js';
import { trackAnalysis } from '../services/usage.service.js';
import { getUsageStatus, incrementFreeCount } from '../services/subscription.service.js';
import type { AnalysisResult, NormalizedCall } from '@debugger/shared';

export const debugRouter = Router();

/** Flatten a call tree into a flat list */
function flattenCalls(node: NormalizedCall): NormalizedCall[] {
  return [node, ...node.children.flatMap(flattenCalls)];
}

/** Extract human-readable labels for all addresses found in the analysis.
 *  extraNames is an optional map of additional labels (e.g. TonAPI accountNames). */
function buildAddressLabels(
  result: Omit<AnalysisResult, 'addressLabels' | 'analyzedAt'>,
  extraNames?: Map<string, string>,
): Record<string, string> {
  const labels: Record<string, string> = {};

  // From external name sources (TonAPI accountNames, etc.) — lowest priority, added first
  if (extraNames) {
    for (const [addr, name] of extraNames) {
      if (name) labels[addr] = name;
    }
  }

  // From semantic actions: protocol + involved addresses
  for (const action of result.semanticActions) {
    if (action.protocol) {
      for (const addr of action.involvedAddresses) {
        if (!labels[addr]) labels[addr] = action.protocol;
      }
    }
  }

  // From token flows: label token addresses with symbol
  for (const flow of result.tokenFlows) {
    const tokenAddr = flow.tokenAddress;
    if (tokenAddr && !labels[tokenAddr]) {
      labels[tokenAddr] = flow.tokenSymbol || flow.tokenName;
    }
  }

  // From call tree: contract names + protocol names — highest priority
  for (const call of flattenCalls(result.callTree)) {
    const addr = call.callee;
    if (!addr) continue;
    if (call.contractName) {
      labels[addr] = call.contractName;
    } else if (call.protocol && !labels[addr]) {
      labels[addr] = call.protocol;
    }
  }

  return labels;
}

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
  let agentResult: Awaited<ReturnType<typeof runSolanaAnalysisAgent>> | null = null;
  let agentError: string | null = null;
  try {
    agentResult = await runSolanaAnalysisAgent(
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
  } catch (err) {
    agentError = err instanceof Error ? err.message : String(err);
    console.warn(`[solana] AI agent failed: ${agentError}. Returning raw normalized data.`);
    onStep?.('AI agent unavailable — returning normalized data without narrative.');
  }

  const partial = agentResult ? {
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
  } : {
    txHash,
    networkId,
    success: txData.success,
    gasUsed: txData.computeUnitsConsumed,
    blockNumber: txData.slot,
    callTree,
    tokenFlows: [],
    semanticActions: [],
    riskFlags: [{
      level: 'low' as const,
      type: 'AI_AGENT_UNAVAILABLE',
      description: `AI narrative generation failed: ${agentError ?? 'unknown'}. Raw normalized instruction tree is still available.`,
    }],
    failureReason: undefined,
    llmExplanation: '',
  };
  const result: AnalysisResult = {
    ...partial,
    addressLabels: { ...buildAddressLabels(partial), ...(agentResult?.llmAddressLabels ?? {}) },
    analyzedAt: new Date().toISOString(),
  };

  setCached(txHash, networkId, result);
  return result;
}

async function runTonPipeline(
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

  onStep?.('Fetching TON transaction trace...');
  const txData = await fetchTonTransaction(txHash, networkId);

  onStep?.('Normalizing message tree...');
  const callTree = normalizeTonTransaction(txData);

  onStep?.('Starting TON AI agent...');
  let agentResult: Awaited<ReturnType<typeof runTonAnalysisAgent>> | null = null;
  let agentError: string | null = null;
  try {
    agentResult = await runTonAnalysisAgent(
      {
        txHash,
        networkId,
        success: txData.success,
        exitCode: txData.exitCode,
        lt: txData.lt,
        utime: txData.utime,
        fee: txData.fee,
        account: txData.account,
        callTree,
        txData,
        tokenFlows: [],
        semanticActions: [],
        riskFlags: [],
        failureReason: undefined,
      },
      onAgentProgress,
    );
  } catch (err) {
    agentError = err instanceof Error ? err.message : String(err);
    console.warn(`[ton] AI agent failed: ${agentError}. Returning raw normalized data.`);
    onStep?.('AI agent unavailable — returning normalized data without narrative.');
  }

  let partial;
  let extraLabels: Record<string, string> = {};
  if (agentResult) {
    // In TON, root tx can "succeed" but child messages bounce or event actions fail.
    const hasBounces = agentResult.riskFlags.some(f => f.type === 'BOUNCED_MESSAGE');
    const hasFailedChildren = flattenCalls(agentResult.callTree).some(
      c => !c.success && c.callType !== 'BOUNCE',
    );
    const hasFailedEventActions = txData.eventActions?.some((a: { status: string }) => a.status === 'failed') ?? false;
    const effectiveSuccess = agentResult.success && !hasBounces && !hasFailedChildren && !hasFailedEventActions;

    partial = {
      txHash,
      networkId,
      success: effectiveSuccess,
      gasUsed: Number(agentResult.fee),
      blockNumber: Number(agentResult.lt),
      callTree: agentResult.callTree,
      tokenFlows: agentResult.tokenFlows,
      semanticActions: agentResult.semanticActions,
      riskFlags: agentResult.riskFlags,
      failureReason: agentResult.failureReason,
      llmExplanation: agentResult.llmExplanation,
    };
    extraLabels = agentResult.llmAddressLabels ?? {};
  } else {
    partial = {
      txHash,
      networkId,
      success: txData.success,
      gasUsed: Number(txData.fee),
      blockNumber: Number(txData.lt),
      callTree,
      tokenFlows: [],
      semanticActions: [],
      riskFlags: [{
        level: 'low' as const,
        type: 'AI_AGENT_UNAVAILABLE',
        description: `AI narrative generation failed: ${agentError ?? 'unknown'}. Raw TON message tree is still available.`,
      }],
      failureReason: undefined,
      llmExplanation: '',
    };
  }
  const result: AnalysisResult = {
    ...partial,
    addressLabels: { ...buildAddressLabels(partial, txData.accountNames), ...extraLabels },
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

  // ── Tenderly simulation (graceful fallback) ───────────────────────────────
  onStep?.('Simulating on Tenderly...');
  let simulation: Awaited<ReturnType<typeof simulateTransaction>> | null = null;
  let simulationError: string | null = null;
  try {
    simulation = await simulateTransaction(txParams, networkId);
  } catch (err) {
    simulationError = err instanceof Error ? err.message : String(err);
    console.warn(`[debug] Tenderly simulation failed: ${simulationError}. Falling back to receipt-only analysis.`);
    onStep?.('Tenderly unavailable — building fallback from on-chain data...');
  }

  // Full-sim path unavailable → degrade to receipt-log analysis
  // but STILL run the LLM agent with simulation=null so it produces a narrative
  // from what we have (synthetic call tree + receipt-derived token flows + semantic actions).
  if (!simulation) {
    const base = await buildFallbackAnalysis(txHash, networkId, txParams, simulationError ?? 'unknown');
    onStep?.('Running AI agent in fallback mode (simulation unavailable)...');
    try {
      const agentResult = await runAnalysisAgent(
        {
          txHash,
          networkId: Number(networkId),
          success: base.success,
          gasUsed: base.gasUsed,
          blockNumber: base.blockNumber,
          callTree: base.callTree,
          simulation: null,
          txParams,
          tokenFlows: base.tokenFlows,
          semanticActions: base.semanticActions,
          riskFlags: base.riskFlags,
          failureReason: base.failureReason,
        },
        onAgentProgress,
      );
      const result: AnalysisResult = {
        ...base,
        // Agent may enrich these; keep its versions
        tokenFlows: agentResult.tokenFlows.length ? agentResult.tokenFlows : base.tokenFlows,
        semanticActions: agentResult.semanticActions.length ? agentResult.semanticActions : base.semanticActions,
        riskFlags: mergeUniqueRiskFlags(base.riskFlags, agentResult.riskFlags),
        failureReason: agentResult.failureReason ?? base.failureReason,
        llmExplanation: agentResult.llmExplanation,
        addressLabels: { ...base.addressLabels, ...(agentResult.llmAddressLabels ?? {}) },
      };
      setCached(txHash, networkId, result);
      return result;
    } catch (err) {
      const agentError = err instanceof Error ? err.message : String(err);
      console.warn(`[debug] AI agent failed in fallback mode: ${agentError}. Returning receipt-only result.`);
      const result: AnalysisResult = {
        ...base,
        riskFlags: [
          ...base.riskFlags,
          {
            level: 'low' as const,
            type: 'AI_AGENT_UNAVAILABLE',
            description: `AI narrative generation failed: ${agentError}. Receipt-decoded data is still available.`,
          },
        ],
      };
      setCached(txHash, networkId, result);
      return result;
    }
  }

  const txInfo = simulation.transaction.transaction_info;

  onStep?.('Normalizing call trace...');
  const callTree = normalizeCallTrace(txInfo.call_trace);

  // ── LLM agent (graceful fallback) ────────────────────────────────────────
  onStep?.('Starting AI agent...');
  let agentResult: Awaited<ReturnType<typeof runAnalysisAgent>> | null = null;
  let agentError: string | null = null;
  try {
    agentResult = await runAnalysisAgent(
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
  } catch (err) {
    agentError = err instanceof Error ? err.message : String(err);
    console.warn(`[debug] AI agent failed: ${agentError}. Returning simulation-only result.`);
    onStep?.('AI agent unavailable — returning simulation results without narrative.');
  }

  let partial;
  let extraRisk: AnalysisResult['riskFlags'] = [];
  let llmAddressLabels: Record<string, string> = {};

  if (agentResult) {
    partial = {
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
    };
    llmAddressLabels = agentResult.llmAddressLabels ?? {};
  } else {
    extraRisk = [{
      level: 'low',
      type: 'AI_AGENT_UNAVAILABLE',
      description: `AI narrative generation failed: ${agentError ?? 'unknown'}. Call tree and simulation data are available; high-level summary is not.`,
    }];
    partial = {
      txHash,
      networkId,
      success: txParams.onChainStatus,
      gasUsed: txParams.gasUsed,
      blockNumber: txParams.blockNumber,
      callTree,
      tokenFlows: [],
      semanticActions: [],
      riskFlags: extraRisk,
      failureReason: undefined,
      llmExplanation: '',
    };
  }
  const result: AnalysisResult = {
    ...partial,
    addressLabels: { ...buildAddressLabels(partial), ...llmAddressLabels },
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
  if (isTonNetwork(networkId)) {
    return runTonPipeline(txHash, networkId, onStep, onAgentProgress);
  }
  return runEvmPipeline(txHash, networkId, onStep, onAgentProgress);
}

// ─── Hash format detection ────────────────────────────────────────────────────

function detectHashFamily(txHash: string): 'evm' | 'ton' | 'solana' | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(txHash)) return 'evm';
  // TON: base64 44 chars (contains +, /, or =) or raw 64 hex (no 0x prefix)
  if (/^[A-Za-z0-9+/=]{44}$/.test(txHash) && /[+/=]/.test(txHash)) return 'ton';
  if (/^[0-9a-fA-F]{64}$/.test(txHash)) return 'ton';
  // Solana: base58 43-88 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(txHash)) return 'solana';
  return null;
}

/** Cached EVM providers — reused across requests */
const providerCache = new Map<string, ethers.JsonRpcProvider>();

function getProvider(chainId: string): ethers.JsonRpcProvider {
  let provider = providerCache.get(chainId);
  if (!provider) {
    provider = new ethers.JsonRpcProvider(
      config.rpcUrls[chainId],
      Number(chainId),
      { staticNetwork: true },
    );
    providerCache.set(chainId, provider);
  }
  return provider;
}

/** Try to find which EVM chain has this tx by querying RPCs in parallel */
async function detectEvmChain(txHash: string): Promise<string | null> {
  const chainIds = Object.keys(config.rpcUrls);
  const results = await Promise.allSettled(
    chainIds.map(async (chainId) => {
      const provider = getProvider(chainId);
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) return chainId;
      throw new Error('not found');
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') return r.value;
  }
  return null;
}

// ─── Network detection endpoint ──────────────────────────────────────────────

debugRouter.get('/detect-network', async (req: Request, res: Response) => {
  const txHash = typeof req.query.txHash === 'string' ? req.query.txHash.trim() : undefined;
  if (!txHash || txHash.length < 32 || txHash.length > 128) {
    res.status(400).json({ error: 'Missing or invalid txHash' });
    return;
  }

  const family = detectHashFamily(txHash);
  if (!family) {
    res.status(400).json({ error: 'Unrecognized transaction hash format' });
    return;
  }

  if (family === 'ton') {
    res.json({ networkId: 'ton-mainnet' });
    return;
  }
  if (family === 'solana') {
    res.json({ networkId: 'solana-mainnet' });
    return;
  }

  // EVM: try to find the chain
  const chainId = await detectEvmChain(txHash);
  if (!chainId) {
    res.status(404).json({ error: 'Transaction not found on any supported EVM chain' });
    return;
  }
  res.json({ networkId: chainId });
});

// ─── SSE streaming endpoint ───────────────────────────────────────────────────

debugRouter.get('/stream', async (req: Request, res: Response) => {
  const txHash = typeof req.query.txHash === 'string' ? req.query.txHash.trim() : undefined;
  let networkId = typeof req.query.networkId === 'string' ? req.query.networkId.trim() : undefined;

  if (!txHash || txHash.length < 32 || txHash.length > 128) {
    res.status(400).json({ error: 'Missing or invalid txHash' });
    return;
  }

  // Validate networkId if provided — must be a known network
  const VALID_NETWORKS = new Set([
    ...Object.keys(config.rpcUrls),
    'ton-mainnet', 'ton-testnet', 'solana-mainnet', 'solana-devnet',
  ]);
  if (networkId && !VALID_NETWORKS.has(networkId)) {
    res.status(400).json({ error: 'Unknown networkId' });
    return;
  }

  // Auto-detect network if not provided
  if (!networkId) {
    const family = detectHashFamily(txHash);
    if (!family) {
      res.status(400).json({ error: 'Unrecognized transaction hash format' });
      return;
    }
    if (family === 'ton') networkId = 'ton-mainnet';
    else if (family === 'solana') networkId = 'solana-mainnet';
    else {
      const chainId = await detectEvmChain(txHash);
      if (!chainId) {
        res.status(404).json({ error: 'Transaction not found on any supported EVM chain' });
        return;
      }
      networkId = chainId;
    }
  }

  // Enforce daily limit for authenticated users
  if (req.telegramUser) {
    const usageStatus = getUsageStatus(req.telegramUser.id);
    if (!usageStatus.allowed) {
      res.status(429).json({
        error: 'DAILY_LIMIT_REACHED',
        message: `You've used all ${usageStatus.limit} free analyses today. Upgrade to Pro for unlimited access.`,
        used: usageStatus.used,
        limit: usageStatus.limit,
        remaining: 0,
      });
      return;
    }
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Send SSE heartbeats every 10s to prevent Cloudflare/proxy idle timeouts.
  // Must be real data events (not SSE comments) so Cloudflare resets its idle timer.
  const heartbeat = setInterval(() => {
    try { send({ type: 'heartbeat' }); } catch { /* connection closed */ }
  }, 10_000);

  try {
    send({ type: 'step', message: `Detected network: ${networkId}` });
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

    clearInterval(heartbeat);

    // Increment daily count and admin stats after successful analysis
    if (req.telegramUser) {
      incrementFreeCount(req.telegramUser.id);
      trackAnalysis(req.telegramUser.id, req.telegramUser.firstName, req.telegramUser.username, txHash);
    }

    send({ type: 'complete', result });
    res.end();
  } catch (err) {
    clearInterval(heartbeat);
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
