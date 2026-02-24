import OpenAI from 'openai';
import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AnalysisResult } from '@debugger/shared';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, '../../../logs');

async function savePromptLog(
  txHash: string,
  systemPrompt: string,
  userPrompt: string,
  response: string
): Promise<void> {
  try {
    await mkdir(LOGS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const short = txHash.slice(0, 10);
    const content = [
      '═'.repeat(80),
      `TX:        ${txHash}`,
      `TIMESTAMP: ${new Date().toISOString()}`,
      `MODEL:     ${config.openrouter.model}`,
      '═'.repeat(80),
      '',
      '─── SYSTEM PROMPT ───────────────────────────────────────────────────────────',
      systemPrompt,
      '',
      '─── USER PROMPT ─────────────────────────────────────────────────────────────',
      userPrompt,
      '',
      '─── LLM RESPONSE ────────────────────────────────────────────────────────────',
      response,
      '',
    ].join('\n');
    await writeFile(resolve(LOGS_DIR, `${ts}_${short}.txt`), content, 'utf8');
  } catch (err) {
    // Non-fatal — log to console but don't break the request
    console.warn('[llm] Failed to write prompt log:', err);
  }
}

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openrouter.apiKey,
      baseURL: config.openrouter.baseURL,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/ai-tx-debugger',
        'X-Title': 'AI Transaction Debugger',
      },
    });
  }
  return openaiClient;
}

function buildSystemPrompt(): string {
  return `You are an expert DeFi transaction analyst and security researcher.
You receive structured JSON data about Ethereum/EVM transactions and provide clear, accurate explanations.

Your explanations must be:
- Written for a technically literate but non-expert audience
- Concise and structured with clear sections
- Factual — only state what is supported by the data
- Actionable — for failures, suggest fixes

Format your response as:
**Summary**: (2-3 sentences of what happened)
**Step-by-step**: (numbered list of what occurred)
**Token flows**: (brief description of money movement)
**Risks**: (only if risk flags exist, otherwise omit)
**Failure analysis**: (only if transaction failed, otherwise omit)`;
}

// Walk the tree and return the IDs of every node on the path from root
// to the deepest failed call (the actual revert origin).
function findRevertPath(node: AnalysisResult['callTree'], current: string[] = []): string[] {
  const path = [...current, node.id];

  if (!node.success) {
    // Try to find a deeper failure inside children
    for (const child of node.children) {
      const deeper = findRevertPath(child, path);
      if (deeper.length > 0) return deeper;
    }
    // No deeper failure — this node is the revert origin
    return path;
  }

  // Node succeeded; check children anyway (a child can fail without
  // propagating success=false all the way up in some trace shapes)
  for (const child of node.children) {
    const deeper = findRevertPath(child, path);
    if (deeper.length > 0) return deeper;
  }

  return [];
}

// Renders the call tree as indented text for the LLM.
// Nodes on the revert path are always rendered regardless of depth/line caps.
// revertOriginId is the single deepest failed node — the only one that gets ◄.
function buildCallTreeText(
  node: AnalysisResult['callTree'],
  depth = 0,
  lines: string[] = [],
  maxDepth = 6,
  maxLines = 80,
  revertPath: Set<string> = new Set(),
  revertOriginId = ''
): string[] {
  const onRevertPath = revertPath.has(node.id);

  // Apply line cap only to nodes NOT on the revert path
  if (!onRevertPath && lines.length >= maxLines) return lines;

  const indent = '  '.repeat(depth);
  const status = node.success ? '✓' : '✗ REVERT';
  const callType = node.callType ?? 'CALL';
  const contract = node.contractName ?? node.callee.slice(0, 10) + '...';
  const fn = node.functionName
    ? `.${node.functionName.split('(')[0]}`
    : node.functionSelector
      ? `[${node.functionSelector}]`
      : '';
  const gas = `${node.gasUsed.toLocaleString()} gas`;
  const revert = !node.success && node.revertReason ? ` — "${node.revertReason.trim()}"` : '';
  const protocol = node.protocol ? ` [${node.protocol}]` : '';
  // Only the deepest failed call gets the marker, not every failed ancestor
  const marker = node.id === revertOriginId ? ' ◄ REVERT ORIGIN' : '';

  lines.push(`${indent}${callType} ${contract}${fn}${protocol} | ${gas} | ${status}${revert}${marker}`);

  const withinDepthLimit = depth < maxDepth;

  if (withinDepthLimit || onRevertPath) {
    for (const child of node.children) {
      const childOnPath = revertPath.has(child.id);
      // Children of a revert-path node are shown unconditionally —
      // they are the context immediately around the failure.
      if (!childOnPath && !onRevertPath && lines.length >= maxLines) {
        lines.push(`${indent}  ... (truncated)`);
        break;
      }
      buildCallTreeText(child, depth + 1, lines, maxDepth, maxLines, revertPath, revertOriginId);
    }
  } else if (node.children.length > 0) {
    lines.push(`${'  '.repeat(depth + 1)}... (${node.children.length} more calls)`);
  }

  return lines;
}

function buildUserPrompt(result: Omit<AnalysisResult, 'llmExplanation'>): string {
  const statusStr = result.success ? '✅ SUCCESS' : '❌ FAILED';

  const actionsStr = result.semanticActions.length > 0
    ? result.semanticActions.map(a =>
        `  - ${a.type}${a.protocol ? ` via ${a.protocol}` : ''}: ${a.description}`
      ).join('\n')
    : '  - No high-level actions detected';

  const flowsStr = result.tokenFlows.length > 0
    ? result.tokenFlows.map(f =>
        `  - ${f.type}: ${f.formattedAmount} ${f.tokenSymbol} from ${f.from.slice(0, 10)}... to ${f.to.slice(0, 10)}...${f.dollarValue ? ` (~$${f.dollarValue})` : ''}`
      ).join('\n')
    : '  - No token flows detected';

  const risksStr = result.riskFlags.length > 0
    ? result.riskFlags.map(r =>
        `  - [${r.level.toUpperCase()}] ${r.type}: ${r.description}`
      ).join('\n')
    : '  - No risk flags';

  const f = result.failureReason;
  const failureStr = f
    ? `Revert reason: "${f.reason}"\nExplanation: ${f.explanation}`
    : 'N/A';

  const revertPath = findRevertPath(result.callTree);
  const revertPathIds = new Set(revertPath);
  const revertOriginId = revertPath.at(-1) ?? '';
  const callTreeLines = buildCallTreeText(result.callTree, 0, [], 6, 80, revertPathIds, revertOriginId);
  const callTreeStr = callTreeLines.join('\n');

  return `Analyze this EVM transaction:

**Transaction**: ${result.txHash}
**Network**: ${result.networkId}
**Status**: ${statusStr}
**Gas used**: ${result.gasUsed.toLocaleString()}
**Block**: ${result.blockNumber}

**Call tree** (indented by depth, ✗ = revert):
${callTreeStr}

**Detected actions**:
${actionsStr}

**Token flows**:
${flowsStr}

**Risk flags**:
${risksStr}

**Failure information**:
${failureStr}

Provide your structured explanation now.`;
}

export async function generateExplanation(
  result: Omit<AnalysisResult, 'llmExplanation'>
): Promise<string> {
  const openai = getOpenAI();
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(result);

  const response = await openai.chat.completions.create({
    model: config.openrouter.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 1000,
  });

  const answer = response.choices[0]?.message?.content ?? 'Unable to generate explanation.';
  await savePromptLog(result.txHash, systemPrompt, userPrompt, answer);
  return answer;
}

export async function answerQuestion(
  result: AnalysisResult,
  question: string
): Promise<string> {
  const openai = getOpenAI();

  const context = `Transaction context:
- Hash: ${result.txHash}
- Status: ${result.success ? 'success' : 'failed'}
- Actions: ${result.semanticActions.map(a => a.description).join('; ')}
- Token flows: ${result.tokenFlows.map(f => `${f.formattedAmount} ${f.tokenSymbol} from ${f.from} to ${f.to}`).join('; ')}
- Risks: ${result.riskFlags.map(r => r.description).join('; ') || 'none'}
- Gas used: ${result.gasUsed}
- Block: ${result.blockNumber}
${result.failureReason ? `- Failure reason: ${result.failureReason.reason}` : ''}

Previous explanation:
${result.llmExplanation}`;

  const qaSystemPrompt = 'You are a DeFi transaction analyst. Answer questions about the transaction using only the provided context. Be concise and precise.';
  const qaUserPrompt = `${context}\n\nQuestion: ${question}`;

  const response = await openai.chat.completions.create({
    model: config.openrouter.model,
    messages: [
      { role: 'system', content: qaSystemPrompt },
      { role: 'user', content: qaUserPrompt },
    ],
    temperature: 0.2,
    max_tokens: 500,
  });

  const answer = response.choices[0]?.message?.content ?? 'Unable to answer question.';
  await savePromptLog(result.txHash, qaSystemPrompt, qaUserPrompt, answer);
  return answer;
}
