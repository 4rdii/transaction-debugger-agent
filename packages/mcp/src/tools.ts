import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  debugTransactionNoLLM,
  getCallTree,
  getTokenFlows,
  getRiskFlags,
  resolveRangoSwap,
} from './pipeline.js';
import type { DebugData } from './pipeline.js';

const MAX_TREE_DEPTH = 6;
const MAX_TREE_LINES = 150;

/** Does any node in this subtree have a revert? */
function hasRevert(node: any): boolean {
  if (!node.success) return true;
  return (node.children ?? []).some((c: any) => hasRevert(c));
}

/** Format a NormalizedCall tree as indented text with depth/line limits.
 *  Reverted paths are always shown in full (no depth/line cap). */
function formatCallTree(node: any, depth = 0, ctx: { lines: number } = { lines: 0 }, onRevertPath = false): string {
  const revertPath = onRevertPath || !node.success;

  if (!revertPath && ctx.lines >= MAX_TREE_LINES) return '';

  const indent = '  '.repeat(depth);
  const status = node.success ? '' : ' [REVERTED]';
  const fn = node.functionName ?? node.functionSelector ?? '(unknown)';
  const contract = node.contractName ? `${node.contractName}.` : '';
  const gas = node.gasUsed ? ` (${node.gasUsed.toLocaleString()} gas)` : '';
  const revert = node.revertReason ? ` — "${node.revertReason}"` : '';
  const protocol = node.protocol ? ` [${node.protocol}]` : '';
  const line = `${indent}${node.callType} ${contract}${fn}${protocol}${gas}${status}${revert}`;
  ctx.lines++;

  const result = [line];
  const children = node.children ?? [];

  if (!revertPath && depth >= MAX_TREE_DEPTH && children.length > 0) {
    // Only collapse successful branches at depth limit
    const revertChildren = children.filter((c: any) => hasRevert(c));
    if (revertChildren.length > 0) {
      // Still show children that lead to reverts
      const okCount = children.length - revertChildren.length;
      if (okCount > 0) {
        result.push(`${indent}  ... (${okCount} successful sub-calls omitted)`);
        ctx.lines++;
      }
      for (const child of revertChildren) {
        const childText = formatCallTree(child, depth + 1, ctx, false);
        if (childText) result.push(childText);
      }
    } else {
      result.push(`${indent}  ... (${children.length} sub-calls omitted)`);
      ctx.lines++;
    }
  } else {
    for (const child of children) {
      const childOnRevertPath = revertPath || hasRevert(child);
      if (!childOnRevertPath && ctx.lines >= MAX_TREE_LINES) {
        result.push(`${indent}  ... (truncated, ${MAX_TREE_LINES} line limit)`);
        break;
      }
      const childText = formatCallTree(child, depth + 1, ctx, revertPath);
      if (childText) result.push(childText);
    }
  }

  return result.join('\n');
}

/** Format full debug data as readable text for Claude Code to analyze. */
function formatDebugData(data: DebugData): string {
  const sections: string[] = [];

  // Header
  sections.push(`Transaction: ${data.txHash}`);
  sections.push(`Network: ${data.networkId}`);
  sections.push(`Status: ${data.success ? 'SUCCESS' : 'FAILED'}`);
  sections.push(`Gas used: ${data.gasUsed.toLocaleString()}`);
  sections.push(`Block: ${data.blockNumber}`);
  sections.push('');

  // Call tree
  sections.push('== CALL TREE ==');
  sections.push(formatCallTree(data.callTree));
  sections.push('');

  // Token flows
  if (data.tokenFlows.length > 0) {
    sections.push('== TOKEN FLOWS ==');
    for (const f of data.tokenFlows) {
      const dollar = f.dollarValue ? ` (~$${f.dollarValue})` : '';
      sections.push(`${f.type}: ${f.formattedAmount} ${f.tokenSymbol} from ${f.from} → ${f.to}${dollar}`);
    }
    sections.push('');
  }

  // Semantic actions
  if (data.semanticActions.length > 0) {
    sections.push('== ACTIONS ==');
    for (const a of data.semanticActions) {
      sections.push(`${a.type}${a.protocol ? ` via ${a.protocol}` : ''}: ${a.description}`);
    }
    sections.push('');
  }

  // Failure reason
  if (data.failureReason) {
    sections.push('== FAILURE ANALYSIS ==');
    sections.push(`Revert reason: "${data.failureReason.reason}"`);
    sections.push(`Explanation: ${data.failureReason.explanation}`);
    sections.push('');
  }

  // Risk flags
  if (data.riskFlags.length > 0) {
    sections.push('== RISK FLAGS ==');
    for (const r of data.riskFlags) {
      sections.push(`[${r.level.toUpperCase()}] ${r.type}: ${r.description}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

export function registerTools(server: McpServer): void {
  // ── debug_transaction (full pipeline, no LLM — Claude Code is the analyst) ─
  server.tool(
    'debug_transaction',
    'Fetch, simulate, and analyze a transaction: builds the call tree, extracts token flows, detects DeFi actions, identifies failure reasons and risk flags. Returns structured text for you to interpret — no external LLM is called.',
    {
      txHash: z.string().describe('Transaction hash (0x... for EVM, base58 for Solana, base64/hex for TON)'),
      networkId: z.string().describe('Network ID: "1" (Ethereum), "137" (Polygon), "42161" (Arbitrum), "10" (Optimism), "8453" (Base), "56" (BSC), "solana-mainnet", "solana-devnet", "ton-mainnet", "ton-testnet", etc.'),
    },
    async ({ txHash, networkId }) => {
      const data = await debugTransactionNoLLM(txHash, networkId);
      return {
        content: [{ type: 'text', text: formatDebugData(data) }],
      };
    },
  );

  // ── get_call_tree (granular, no LLM) ──────────────────────────────
  server.tool(
    'get_call_tree',
    'Fetch and decode the call tree of a transaction without running the AI analysis. Returns an indented trace of all internal calls, showing contract names, functions, and revert reasons.',
    {
      txHash: z.string().describe('Transaction hash'),
      networkId: z.string().describe('Network ID (e.g. "1", "137", "solana-mainnet", "ton-mainnet")'),
    },
    async ({ txHash, networkId }) => {
      const tree = await getCallTree(txHash, networkId);
      const formatted = formatCallTree(tree);
      return {
        content: [{ type: 'text', text: formatted }],
      };
    },
  );

  // ── get_token_flows (granular) ────────────────────────────────────
  server.tool(
    'get_token_flows',
    'Extract all token transfers (ERC20, ERC721, native ETH) from a transaction. Returns from, to, token, and amount for each flow.',
    {
      txHash: z.string().describe('Transaction hash'),
      networkId: z.string().describe('Network ID (e.g. "1", "137")'),
    },
    async ({ txHash, networkId }) => {
      const flows = await getTokenFlows(txHash, networkId);
      if (flows.length === 0) {
        return { content: [{ type: 'text', text: 'No token flows detected in this transaction.' }] };
      }
      const summary = flows.map(f =>
        `${f.type}: ${f.formattedAmount} ${f.tokenSymbol} from ${f.from} → ${f.to}`
      ).join('\n');
      return {
        content: [{ type: 'text', text: summary }],
      };
    },
  );

  // ── get_risk_flags (granular) ─────────────────────────────────────
  server.tool(
    'get_risk_flags',
    'Detect security risk flags in a transaction: unlimited approvals, large value transfers, flash loans, delegatecalls to untrusted contracts, etc.',
    {
      txHash: z.string().describe('Transaction hash'),
      networkId: z.string().describe('Network ID (e.g. "1", "137")'),
    },
    async ({ txHash, networkId }) => {
      const flags = await getRiskFlags(txHash, networkId);
      if (flags.length === 0) {
        return { content: [{ type: 'text', text: 'No risk flags detected in this transaction.' }] };
      }
      const summary = flags.map(f =>
        `[${f.level.toUpperCase()}] ${f.type}: ${f.description}`
      ).join('\n');
      return {
        content: [{ type: 'text', text: summary }],
      };
    },
  );

  // ── resolve_rango_swap ────────────────────────────────────────────
  server.tool(
    'resolve_rango_swap',
    'Look up a Rango cross-chain swap by its swap ID. Returns the swap route overview: source/destination tokens, intermediate steps, per-step status, and the individual transaction hashes that can be debugged.',
    {
      swapId: z.string().describe('Rango swap ID (UUID from the Rango explorer URL)'),
    },
    async ({ swapId }) => {
      const overview = await resolveRangoSwap(swapId);
      const header = `${overview.fromToken.amount} ${overview.fromToken.symbol} (${overview.fromToken.chain}) → ${overview.toToken.amount} ${overview.toToken.symbol} (${overview.toToken.chain})`;
      const stepLines = overview.steps.map(s =>
        `  Step ${s.stepIndex}: ${s.from.symbol} (${s.from.chain}) → ${s.to.symbol} (${s.to.chain}) via ${s.swapper.title} [${s.status}]`
      ).join('\n');
      const txLines = overview.transactions.map(t =>
        `  ${t.chainDisplayName}: ${t.txHash}${t.analyzable ? '' : ' (not analyzable)'}`
      ).join('\n');
      const summary = `Swap: ${header}\nStatus: ${overview.status}\n\nSteps:\n${stepLines}\n\nTransactions:\n${txLines}`;
      return {
        content: [{ type: 'text', text: summary }],
      };
    },
  );
}
