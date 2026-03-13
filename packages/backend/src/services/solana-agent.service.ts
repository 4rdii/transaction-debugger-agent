import OpenAI from 'openai';
import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseAddressLabels } from './agent.service.js';
import type {
  NormalizedCall,
  TokenFlow,
  SemanticAction,
  SemanticActionType,
  RiskFlag,
  FailureReason,
  SolanaTxData,
} from '@debugger/shared';
import { config } from '../config.js';
import { getOpenAI } from './openai.service.js';
import { extractSolanaTokenFlows } from './solana-tokenflow.service.js';
import {
  SOLANA_DEX_PROGRAMS,
  SOLANA_BRIDGE_PROGRAMS,
  lookupProgramName,
} from '../registry/solana-programs.js';
import {
  parseInstructionError,
  lookupProgramError,
  getFailingProgramId,
} from './solana-idl.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, '../../../logs');

const MAX_TURNS = 4;

// ─── Agent state ─────────────────────────────────────────────────────────────

export interface SolanaAgentState {
  signature: string;
  networkId: string;
  success: boolean;
  computeUnitsConsumed: number;
  slot: number;
  fee: number;
  callTree: NormalizedCall;
  txData: SolanaTxData;
  tokenFlows: TokenFlow[];
  semanticActions: SemanticAction[];
  riskFlags: RiskFlag[];
  failureReason: FailureReason | undefined;
}

// ─── Call tree text builder (reused from EVM agent pattern) ──────────────────

function buildSolanaCallTreeText(
  node: NormalizedCall,
  depth = 0,
  lines: string[] = [],
): string[] {
  const indent = '  '.repeat(depth);
  const status = node.success ? '✓' : '✗ REVERT';
  const callType = node.callType ?? 'INVOKE';
  const contract = node.contractName
    ? `${node.contractName} [${node.callee}]`
    : node.callee;
  const fn = node.functionName ? `.${node.functionName}` : '';
  const cu = node.gasUsed > 0 ? ` | ${node.gasUsed.toLocaleString()} CU` : '';
  const revert = !node.success && node.revertReason ? ` — "${node.revertReason.trim()}"` : '';
  const protocol = node.protocol ? ` [${node.protocol}]` : '';

  lines.push(`${indent}${callType} ${contract}${fn}${protocol}${cu} | ${status}${revert}`);

  for (const child of node.children) {
    buildSolanaCallTreeText(child, depth + 1, lines);
  }

  return lines;
}

// ─── Optional tool definitions (only these are exposed to the LLM) ──────────
// Deterministic tools (instruction tree, token flows, failure, actions, risks)
// are pre-executed and injected into the prompt to save tokens.

const OPTIONAL_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_program_error',
      description:
        'Look up a custom Solana program error code to get its name and human-readable message. Checks a known error registry for popular programs (Jupiter, Raydium, Orca, SPL Token) and falls back to fetching the program\'s Anchor IDL from on-chain.',
      parameters: {
        type: 'object',
        properties: {
          programId: { type: 'string', description: 'The program ID (base58 address) that produced the error' },
          errorCode: { type: 'number', description: 'The numeric custom error code (e.g. 6001 for 0x1771)' },
        },
        required: ['programId', 'errorCode'],
      },
    },
  },
];

// ─── Tool implementations ────────────────────────────────────────────────────

function flattenCalls(node: NormalizedCall): NormalizedCall[] {
  return [node, ...node.children.flatMap(flattenCalls)];
}

function detectSolanaActions(state: SolanaAgentState): SemanticAction[] {
  const allCalls = flattenCalls(state.callTree);
  const actions: SemanticAction[] = [];

  for (const call of allCalls) {
    const programId = call.callee;

    // Swap detection — known DEX programs
    if (SOLANA_DEX_PROGRAMS.has(programId)) {
      const tokenSymbols = state.tokenFlows
        .filter(f => f.type === 'Transfer')
        .map(f => f.tokenSymbol);
      actions.push({
        type: 'Swap',
        protocol: call.contractName ?? lookupProgramName(programId),
        callId: call.id,
        description: `Token swap via ${call.contractName ?? programId}`,
        involvedTokens: [...new Set(tokenSymbols)],
        involvedAddresses: [call.caller, call.callee],
      });
      continue;
    }

    // Bridge detection
    if (SOLANA_BRIDGE_PROGRAMS.has(programId)) {
      actions.push({
        type: 'Bridge',
        protocol: call.contractName ?? lookupProgramName(programId),
        callId: call.id,
        description: `Cross-chain bridge via ${call.contractName ?? programId}`,
        involvedTokens: [],
        involvedAddresses: [call.caller, call.callee],
      });
      continue;
    }

    // Staking detection
    if (programId === 'Stake11111111111111111111111111111111111111' ||
        programId === 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD' ||
        programId === 'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy') {
      const fnName = (call.functionName ?? '').toLowerCase();
      const actionType: SemanticActionType = fnName.includes('unstake') || fnName.includes('withdraw')
        ? 'Withdraw'
        : 'Deposit';
      actions.push({
        type: actionType,
        protocol: call.contractName ?? 'Solana Staking',
        callId: call.id,
        description: `Staking ${actionType.toLowerCase()} via ${call.contractName ?? programId}`,
        involvedTokens: ['SOL'],
        involvedAddresses: [call.caller, call.callee],
      });
      continue;
    }

    // NFT operations (Metaplex, Tensor, Magic Eden)
    if (programId === 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s' ||
        programId === 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN' ||
        programId === 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K') {
      actions.push({
        type: 'Transfer',
        protocol: call.contractName ?? 'NFT',
        callId: call.id,
        description: `NFT operation via ${call.contractName ?? programId}`,
        involvedTokens: [],
        involvedAddresses: [call.caller, call.callee],
      });
    }
  }

  // If no actions detected but there are token transfers, add a generic Transfer
  if (actions.length === 0 && state.tokenFlows.length > 0) {
    const symbols = [...new Set(state.tokenFlows.map(f => f.tokenSymbol))];
    actions.push({
      type: 'Transfer',
      protocol: 'SPL Token',
      callId: state.callTree.id,
      description: `Token transfer of ${symbols.join(', ')}`,
      involvedTokens: symbols,
      involvedAddresses: [...new Set(state.tokenFlows.flatMap(f => [f.from, f.to]))],
    });
  }

  return actions;
}

async function analyzeSolanaFailure(state: SolanaAgentState): Promise<FailureReason | undefined> {
  if (state.success) return undefined;

  const logs = state.txData.logMessages;
  let reason = '';
  let failingProgramId = '';

  // 1. Parse the structured InstructionError from meta.err
  const rawErr = state.txData.raw.meta.err;
  const parsedErr = parseInstructionError(rawErr);

  let decodedError: { name: string; message: string } | null = null;

  if (parsedErr) {
    // Resolve which program failed
    const instructions = state.txData.raw.transaction.message.instructions;
    const progId = getFailingProgramId(instructions, parsedErr.instructionIndex);
    if (progId) failingProgramId = progId;

    if (parsedErr.builtinError) {
      reason = parsedErr.builtinError;
    } else if (parsedErr.customCode !== undefined && failingProgramId) {
      // Try to decode the custom error code
      decodedError = await lookupProgramError(
        failingProgramId,
        parsedErr.customCode,
        state.networkId,
      );

      const codeHex = '0x' + parsedErr.customCode.toString(16);
      if (decodedError) {
        reason = `Custom error ${parsedErr.customCode} (${codeHex}): ${decodedError.name}`;
      } else {
        reason = `Custom program error ${parsedErr.customCode} (${codeHex})`;
      }
    }
  }

  // 2. Look for specific error patterns in program logs
  for (const line of logs) {
    const failMatch = line.match(/Program (\S+) failed: (.+)/);
    if (failMatch) {
      if (!failingProgramId) failingProgramId = failMatch[1];
      if (!reason) reason = failMatch[2];
    }
    // Anchor programs emit detailed error logs
    if (line.startsWith('Program log: AnchorError')) {
      reason = line.replace('Program log: ', '').trim();
    } else if (line.startsWith('Program log: Error:')) {
      if (!reason) reason = line.replace('Program log: ', '').trim();
    }
  }

  // 3. Fallback to raw error
  if (!reason && rawErr) {
    reason = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);
  }
  if (!reason) reason = 'Transaction failed (unknown reason)';

  // 4. Build explanation
  const programName = failingProgramId
    ? lookupProgramName(failingProgramId) ?? failingProgramId
    : 'unknown program';

  let explanation: string;

  if (decodedError) {
    // We have a decoded error — give a rich explanation
    explanation = `${programName} returned error "${decodedError.name}": ${decodedError.message}.`;
  } else {
    const r = reason.toLowerCase();
    if (r.includes('insufficient funds') || r.includes('insufficient lamports')) {
      explanation = 'The transaction failed because an account did not have enough SOL to cover the operation or rent.';
    } else if (r.includes('account not found') || r.includes('accountnotfound')) {
      explanation = 'A required account was not found on-chain. It may not have been initialized or may have been closed.';
    } else if (r.includes('slippage') || r.includes('exceeds desired')) {
      explanation = 'The swap failed because the price moved beyond the slippage tolerance between submission and execution.';
    } else if (r.includes('already in use') || r.includes('already initialized')) {
      explanation = 'The operation failed because an account was already initialized or in use.';
    } else if (r.includes('overflow') || r.includes('underflow')) {
      explanation = 'An arithmetic overflow or underflow occurred during program execution.';
    } else if (r.includes('custom program error') || r.includes('custom error')) {
      explanation = `${programName} returned a custom error: ${reason}. Use lookup_program_error to decode it.`;
    } else {
      explanation = `The transaction failed with: "${reason}". The failing program was ${programName}.`;
    }
  }

  return {
    rootCallId: state.callTree.id,
    reason,
    explanation,
  };
}

function detectSolanaRisks(state: SolanaAgentState): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const allCalls = flattenCalls(state.callTree);

  // Large SOL transfers (> 10 SOL)
  const LARGE_SOL_THRESHOLD = 10 * 1_000_000_000; // 10 SOL in lamports
  for (const flow of state.tokenFlows) {
    if (flow.tokenSymbol === 'SOL' && flow.type === 'NativeTransfer') {
      const amount = Number(flow.rawAmount);
      if (amount >= LARGE_SOL_THRESHOLD) {
        flags.push({
          level: 'medium',
          type: 'LARGE_SOL_TRANSFER',
          description: `Large SOL transfer of ${flow.formattedAmount} SOL from ${flow.from} to ${flow.to}.`,
        });
      }
    }
  }

  // Interaction with unknown programs
  for (const call of allCalls) {
    if (call.callType === 'INVOKE' || call.callType === 'CPI') {
      if (!lookupProgramName(call.callee) && call.callee !== state.txData.feePayer) {
        flags.push({
          level: 'low',
          type: 'UNKNOWN_PROGRAM',
          description: `Interaction with unrecognized program ${call.callee}.`,
          callId: call.id,
        });
      }
    }
  }

  // Authority change detection (from log messages)
  for (const line of state.txData.logMessages) {
    if (line.toLowerCase().includes('setauthority') || line.toLowerCase().includes('set_authority')) {
      flags.push({
        level: 'high',
        type: 'AUTHORITY_CHANGE',
        description: 'An authority change was detected in this transaction. Verify the new authority is trusted.',
      });
      break;
    }
  }

  return flags;
}

async function executeSolanaTool(
  name: string,
  args: Record<string, unknown>,
  state: SolanaAgentState,
): Promise<string> {
  switch (name) {
    case 'get_instruction_tree': {
      const lines = buildSolanaCallTreeText(state.callTree);
      return lines.join('\n');
    }

    case 'extract_token_flows': {
      const flows = extractSolanaTokenFlows(state.txData);
      state.tokenFlows = flows;
      if (flows.length === 0) return 'No token flows detected.';
      return flows
        .map(
          f =>
            `${f.type}: ${f.formattedAmount} ${f.tokenSymbol} from ${f.from} to ${f.to}`,
        )
        .join('\n');
    }

    case 'analyze_failure': {
      if (state.success) return 'Transaction succeeded — no failure to analyze.';
      const reason = await analyzeSolanaFailure(state);
      state.failureReason = reason;
      if (!reason) return 'Transaction failed but no error could be extracted.';
      return `Error: "${reason.reason}"\nExplanation: ${reason.explanation}`;
    }

    case 'detect_actions': {
      const actions = detectSolanaActions(state);
      state.semanticActions = actions;
      if (actions.length === 0) return 'No high-level actions detected.';
      return actions
        .map(a => `${a.type}${a.protocol ? ` via ${a.protocol}` : ''}: ${a.description}`)
        .join('\n');
    }

    case 'detect_risks': {
      const flags = detectSolanaRisks(state);
      state.riskFlags = flags;
      if (flags.length === 0) return 'No risk flags detected.';
      return flags
        .map(r => `[${r.level.toUpperCase()}] ${r.type}: ${r.description}`)
        .join('\n');
    }

    case 'lookup_program_error': {
      const programId = String(args['programId'] ?? '');
      const errorCode = Number(args['errorCode'] ?? 0);
      if (!programId) return 'programId is required.';

      const error = await lookupProgramError(programId, errorCode, state.networkId);
      if (!error) {
        const programName = lookupProgramName(programId);
        return `No error definition found for code ${errorCode} (0x${errorCode.toString(16)}) on program ${programName ?? programId}. The program may not have a published Anchor IDL.`;
      }

      const programName = lookupProgramName(programId) ?? programId;
      return `Program: ${programName}\nError code: ${errorCode} (0x${errorCode.toString(16)})\nError name: ${error.name}\nMessage: ${error.message}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SOLANA_SYSTEM_PROMPT = `You are an expert Solana transaction analyst.

Key Solana concepts:
- Solana uses **instructions** (not calls/transactions like EVM). Each instruction invokes a **program** (equivalent to a smart contract).
- **CPI (Cross-Program Invocation)** is how one program calls another (similar to contract-to-contract calls in EVM).
- **Compute Units (CU)** are Solana's equivalent of gas. Each tx has a compute budget.
- **SPL Token** is Solana's token standard (like ERC20). SOL is the native currency (9 decimals, denominated in lamports: 1 SOL = 1,000,000,000 lamports).
- Addresses are base58-encoded (not hex like EVM).
- Common DEX programs: **Jupiter** (aggregator, like 1inch), **Raydium** and **Orca** (AMMs, like Uniswap).
- **Associated Token Account (ATA)** — each wallet has one ATA per token mint.

You are provided with pre-analyzed context below. Use it to write your analysis directly.
Only use the lookup_program_error tool if the failure analysis shows an undecoded custom error code and you need more details.
Do NOT mention tools in your answer.

IMPORTANT: You have a maximum of 4 rounds. On round 4 you MUST output your final analysis — no more tool calls. Plan your investigation to finish within this budget.

Final answer format:
**Summary**: (2-3 sentences describing what happened)
**Step-by-step**: (numbered list of what occurred in order)
**Token flows**: (omit this section entirely if there are none)
**Risks**: (omit this section entirely if no risk flags were found)
**Failure analysis**: (omit this section entirely if the transaction succeeded)

IMPORTANT: At the very end of your response, output an address labels block. For EVERY address that appears in the transaction, assign a human-readable role label. Use known program/protocol names when available (e.g. "Jupiter Aggregator", "Raydium AMM", "USDC Mint"). For unknown addresses, assign a descriptive role based on what they did (e.g. "Swapper (sender)", "Liquidity Pool", "Fee Receiver", "Token Account (sender)"). Format:
\`\`\`address_labels
{"abc...full_address": "Role Label", "def...full_address": "Another Label"}
\`\`\``;

function buildSolanaInitialMessage(
  state: SolanaAgentState,
  preAnalyzed: {
    callTreeText: string;
    tokenFlowsText: string;
    failureText: string;
    actionsText: string;
    risksText: string;
  },
): string {
  const status = state.success ? 'SUCCESS ✅' : 'FAILED ❌';
  const network = state.networkId === 'solana-devnet' ? 'Solana Devnet' : 'Solana Mainnet';
  return `Analyze this Solana transaction:

Signature: ${state.signature}
Network: ${network}
Status: ${status}
Compute units used: ${state.computeUnitsConsumed.toLocaleString()}
Fee: ${(state.fee / 1_000_000_000).toFixed(9)} SOL (${state.fee.toLocaleString()} lamports)
Slot: ${state.slot}

## Pre-analyzed context (do NOT re-call these tools)

### Instruction tree
${preAnalyzed.callTreeText}

### Token flows
${preAnalyzed.tokenFlowsText}

### Failure analysis
${preAnalyzed.failureText}

### Detected actions
${preAnalyzed.actionsText}

### Risk flags
${preAnalyzed.risksText}

Use the lookup_program_error tool only if you need to decode a custom error code not already explained above. Otherwise, write your final analysis directly.`;
}

// ─── Log writer ──────────────────────────────────────────────────────────────

async function saveSolanaAgentLog(
  signature: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<void> {
  try {
    await mkdir(LOGS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const short = signature.slice(0, 10);
    const assistantTurns = messages.filter(m => m.role === 'assistant').length;

    const lines: string[] = [
      '═'.repeat(80),
      `SIG:       ${signature}`,
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
        if (a.tool_calls?.length) {
          lines.push(`─── ASSISTANT (${a.tool_calls.length} tool calls) ───`);
          for (const tc of a.tool_calls) {
            lines.push(`  → ${tc.function.name}(${tc.function.arguments})`);
          }
        } else {
          lines.push('─── ASSISTANT (FINAL) ───', typeof a.content === 'string' ? a.content : '', '');
        }
      } else if (msg.role === 'tool') {
        const t = msg as OpenAI.Chat.ChatCompletionToolMessageParam;
        const content = typeof t.content === 'string' ? t.content : JSON.stringify(t.content);
        lines.push(`─── TOOL RESULT ───`, content.slice(0, 2000), '');
      }
    }

    await writeFile(resolve(LOGS_DIR, `${ts}_solana_${short}.txt`), lines.join('\n'), 'utf8');
  } catch (err) {
    console.warn('[solana-agent] Failed to write log:', err);
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

// ─── Agent loop ──────────────────────────────────────────────────────────────

export async function runSolanaAnalysisAgent(
  state: SolanaAgentState,
  onProgress?: ProgressCallback,
): Promise<SolanaAgentState & { llmExplanation: string; llmAddressLabels: Record<string, string> }> {
  const openai = getOpenAI();

  // ─── Pre-execute deterministic tools ────────────────────────────────────────
  // These always run and their results are injected into the prompt,
  // saving multiple LLM turns and reducing token usage significantly.

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['get_instruction_tree'] });
  const callTreeText = buildSolanaCallTreeText(state.callTree).join('\n');
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'get_instruction_tree', summary: callTreeText.split('\n')[0]?.slice(0, 120) ?? '' });

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['extract_token_flows'] });
  const tokenFlows = extractSolanaTokenFlows(state.txData);
  state.tokenFlows = tokenFlows;
  const tokenFlowsText = tokenFlows.length
    ? tokenFlows.map(f => `${f.type}: ${f.formattedAmount} ${f.tokenSymbol} from ${f.from} to ${f.to}`).join('\n')
    : 'None';
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'extract_token_flows', summary: tokenFlowsText.split('\n')[0]?.slice(0, 120) ?? '' });

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['analyze_failure'] });
  const failure = await analyzeSolanaFailure(state);
  state.failureReason = failure;
  const failureText = failure
    ? `Error: "${failure.reason}"\nExplanation: ${failure.explanation}`
    : 'Transaction succeeded';
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'analyze_failure', summary: failureText.split('\n')[0]?.slice(0, 120) ?? '' });

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['detect_actions'] });
  const actions = detectSolanaActions(state);
  state.semanticActions = actions;
  const actionsText = actions.length
    ? actions.map(a => `${a.type}${a.protocol ? ` via ${a.protocol}` : ''}: ${a.description}`).join('\n')
    : 'None';
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'detect_actions', summary: actionsText.split('\n')[0]?.slice(0, 120) ?? '' });

  onProgress?.({ type: 'tool_call', turn: 0, toolNames: ['detect_risks'] });
  const risks = detectSolanaRisks(state);
  state.riskFlags = risks;
  const risksText = risks.length
    ? risks.map(r => `[${r.level.toUpperCase()}] ${r.type}: ${r.description}`).join('\n')
    : 'None';
  onProgress?.({ type: 'tool_result', turn: 0, toolName: 'detect_risks', summary: risksText.split('\n')[0]?.slice(0, 120) ?? '' });

  // ─── LLM loop (only optional tools remain) ─────────────────────────────────

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SOLANA_SYSTEM_PROMPT },
    { role: 'user', content: buildSolanaInitialMessage(state, { callTreeText, tokenFlowsText, failureText, actionsText, risksText }) },
  ];

  let llmExplanation = 'Analysis could not be completed.';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: config.openrouter.model,
      tools: OPTIONAL_TOOLS,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    });

    const msg = response.choices[0]?.message;
    if (!msg) break;

    messages.push(msg as OpenAI.Chat.ChatCompletionMessageParam);

    if (!msg.tool_calls?.length) {
      llmExplanation = msg.content ?? llmExplanation;
      onProgress?.({ type: 'final_answer', turn: turn + 1 });
      break;
    }

    onProgress?.({
      type: 'tool_call',
      turn: turn + 1,
      toolNames: msg.tool_calls.map(tc => tc.function.name),
    });

    for (const tc of msg.tool_calls) {
      let result: string;
      try {
        result = await executeSolanaTool(
          tc.function.name,
          JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
          state,
        );
      } catch (err) {
        result = `Tool execution error: ${String(err)}`;
      }

      const summary = result.split('\n').find(l => l.trim())?.slice(0, 120) ?? '';
      onProgress?.({ type: 'tool_result', turn: turn + 1, toolName: tc.function.name, summary });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }

    // On the penultimate turn, inject a nudge so the next response is the final analysis
    if (turn === MAX_TURNS - 2) {
      messages.push({
        role: 'user',
        content: 'This is your final round. You MUST now write your complete analysis. No more tool calls.',
      });
    }
  }

  await saveSolanaAgentLog(state.signature, messages);

  const parsed = parseAddressLabels(llmExplanation);
  return { ...state, llmExplanation: parsed.explanation, llmAddressLabels: parsed.labels };
}
