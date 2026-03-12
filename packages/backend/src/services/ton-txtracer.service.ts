/**
 * TxTracer integration — re-executes TON transactions locally in a TVM sandbox
 * to get VM-level debugging data: exact exit codes, VM logs, gas per step, etc.
 *
 * Uses txtracer-core (https://github.com/ton-blockchain/TxTracer)
 */

import type { TraceResult, ComputeInfo } from 'txtracer-core';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TxTracerResult {
  /** Whether emulated state hash matches on-chain (sanity check) */
  stateUpdateHashOk: boolean;
  /** Compute phase info */
  compute: {
    success: boolean;
    exitCode: number;
    vmSteps: number;
    gasUsed: string;
  } | null;
  /** Balance before/after + fees */
  money: {
    balanceBefore: string;
    balanceAfter: string;
    totalFees: string;
    sentTotal: string;
  };
  /** VM execution logs (trimmed to useful portion) */
  vmLogSnippet: string;
  /** Executor logs */
  executorLogSnippet: string;
  /** Out actions summary */
  actionsCount: number;
  /** Raw error from tracer if it failed */
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractComputeInfo(info: ComputeInfo): TxTracerResult['compute'] {
  if (info === 'skipped') return null;
  return {
    success: info.success,
    exitCode: info.exitCode,
    vmSteps: info.vmSteps,
    gasUsed: info.gasUsed.toString(),
  };
}

/** Trim VM logs to last N lines (most relevant — failure is usually at the end) */
function trimLogs(logs: string, maxLines = 80): string {
  const lines = logs.split('\n');
  if (lines.length <= maxLines) return logs;
  return `... (${lines.length - maxLines} lines trimmed)\n` + lines.slice(-maxLines).join('\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Re-trace a TON transaction using TxTracer's local TVM emulator.
 * Returns VM-level debug data or a graceful error if tracing fails.
 *
 * This is an optional enrichment step — the pipeline works without it.
 *
 * IMPORTANT: TxTracer needs the actual transaction hash (from TonCenter),
 * NOT the trace/event hash used by TonAPI. In TON, a trace groups multiple
 * transactions — the trace hash ≠ individual transaction hash.
 * Pass the root transaction hash from the trace data.
 */
export async function traceTonTransaction(
  txHash: string,
  networkId: string,
): Promise<TxTracerResult | null> {
  try {
    // Dynamic import to keep it optional (txtracer-core has heavy deps)
    const { retrace } = await import('txtracer-core');
    const isTestnet = networkId === 'ton-testnet';

    // retrace() can take 10-30s as it re-executes in a local TVM sandbox
    const result: TraceResult = await Promise.race([
      retrace(isTestnet, txHash),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TxTracer timeout (30s)')), 30_000),
      ),
    ]);

    const compute = extractComputeInfo(result.emulatedTx.computeInfo);

    return {
      stateUpdateHashOk: result.stateUpdateHashOk,
      compute,
      money: {
        balanceBefore: result.money.balanceBefore.toString(),
        balanceAfter: result.money.balanceAfter.toString(),
        totalFees: result.money.totalFees.toString(),
        sentTotal: result.money.sentTotal.toString(),
      },
      vmLogSnippet: trimLogs(result.emulatedTx.vmLogs),
      executorLogSnippet: trimLogs(result.emulatedTx.executorLogs, 30),
      actionsCount: result.emulatedTx.actions.length,
    };
  } catch (err) {
    // TxTracer may fail for various reasons (old tx, missing state, etc.)
    // This is non-critical — return null so the pipeline continues
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[txtracer] Failed to trace ${txHash}: ${message}`);
    return {
      stateUpdateHashOk: false,
      compute: null,
      money: { balanceBefore: '0', balanceAfter: '0', totalFees: '0', sentTotal: '0' },
      vmLogSnippet: '',
      executorLogSnippet: '',
      actionsCount: 0,
      error: message,
    };
  }
}

/**
 * Format TxTracer result into text for the LLM prompt.
 */
export function formatTxTracerForPrompt(result: TxTracerResult | null): string {
  if (!result) return 'TxTracer: not available';
  if (result.error) return `TxTracer: failed — ${result.error}`;

  const lines: string[] = ['## TVM-level trace (TxTracer)'];
  lines.push(`State hash verified: ${result.stateUpdateHashOk ? 'YES ✓' : 'NO ✗'}`);

  if (result.compute) {
    lines.push(`Compute phase: ${result.compute.success ? 'success' : 'FAILED'}`);
    lines.push(`Exit code: ${result.compute.exitCode}`);
    lines.push(`VM steps: ${result.compute.vmSteps}`);
    lines.push(`Gas used: ${result.compute.gasUsed} nanoTON`);
  } else {
    lines.push('Compute phase: skipped');
  }

  lines.push(`Balance before: ${result.money.balanceBefore} nanoTON`);
  lines.push(`Balance after: ${result.money.balanceAfter} nanoTON`);
  lines.push(`Total fees: ${result.money.totalFees} nanoTON`);
  lines.push(`Total sent: ${result.money.sentTotal} nanoTON`);
  lines.push(`Out actions: ${result.actionsCount}`);

  if (result.vmLogSnippet) {
    lines.push('\n### VM execution log (tail)');
    lines.push('```');
    lines.push(result.vmLogSnippet);
    lines.push('```');
  }

  return lines.join('\n');
}
