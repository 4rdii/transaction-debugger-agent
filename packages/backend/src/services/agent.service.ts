import OpenAI from 'openai';
import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  NormalizedCall,
  TokenFlow,
  SemanticAction,
  RiskFlag,
  FailureReason,
  TenderlySimulateResponse,
} from '@debugger/shared';
import { config } from '../config.js';
import { extractTokenFlows } from './tokenflow.service.js';
import { detectSemanticActions } from './action.service.js';
import { analyzeFailure } from './failure.service.js';
import { detectRisks } from './risk.service.js';
import { getContractAbi, getContractSource } from './etherscan.service.js';
import { castRun, castCall } from './foundry.service.js';
import { simulateWithFix } from './simulate-fix.service.js';
import type { RawTxParams } from './ethers.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, '../../../logs');

const MAX_TURNS = 12;

// ─── OpenAI client ────────────────────────────────────────────────────────────

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

// ─── Agent state ──────────────────────────────────────────────────────────────

export interface AgentState {
  txHash: string;
  networkId: number;
  success: boolean;
  gasUsed: number;
  blockNumber: number;
  callTree: NormalizedCall;
  simulation: TenderlySimulateResponse;
  txParams: RawTxParams;
  tokenFlows: TokenFlow[];
  semanticActions: SemanticAction[];
  failureReason: FailureReason | undefined;
  riskFlags: RiskFlag[];
}

// ─── Call tree utilities ──────────────────────────────────────────────────────

function findRevertPath(node: NormalizedCall, current: string[] = []): string[] {
  const path = [...current, node.id];

  if (!node.success) {
    for (const child of node.children) {
      const deeper = findRevertPath(child, path);
      if (deeper.length > 0) return deeper;
    }
    return path;
  }

  for (const child of node.children) {
    const deeper = findRevertPath(child, path);
    if (deeper.length > 0) return deeper;
  }

  return [];
}

function buildCallTreeText(
  node: NormalizedCall,
  depth = 0,
  lines: string[] = [],
  maxDepth = 6,
  maxLines = 80,
  revertPath: Set<string> = new Set(),
  revertOriginId = '',
): string[] {
  const onRevertPath = revertPath.has(node.id);

  if (!onRevertPath && lines.length >= maxLines) return lines;

  const indent = '  '.repeat(depth);
  const status = node.success ? '✓' : '✗ REVERT';
  const callType = node.callType ?? 'CALL';
  // Always include the full address so the LLM can use it for tool calls
  const contract = node.contractName
    ? `${node.contractName} [${node.callee}]`
    : node.callee;
  const fn = node.functionName
    ? `.${node.functionName.split('(')[0]}`
    : node.functionSelector
      ? `[${node.functionSelector}]`
      : '';
  const gas = `${node.gasUsed.toLocaleString()} gas`;
  const revert = !node.success && node.revertReason ? ` — "${node.revertReason.trim()}"` : '';
  const protocol = node.protocol ? ` [${node.protocol}]` : '';
  const marker = node.id === revertOriginId ? ' ◄ REVERT ORIGIN' : '';

  lines.push(`${indent}${callType} ${contract}${fn}${protocol} | ${gas} | ${status}${revert}${marker}`);

  const withinDepthLimit = depth < maxDepth;

  if (withinDepthLimit || onRevertPath) {
    for (const child of node.children) {
      const childOnPath = revertPath.has(child.id);
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

function findCallById(node: NormalizedCall, id: string): NormalizedCall | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findCallById(child, id);
    if (found) return found;
  }
  return undefined;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_call_tree',
      description:
        'Get an indented text representation of the full call tree, showing contract calls, depth, gas, success/failure status, revert reasons, and protocols. Always call this first.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_token_flows',
      description:
        'Extract all token transfers from the transaction — ERC20, ERC721, ERC1155, and native ETH. Returns amounts, symbols, from/to addresses, and dollar values.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_semantic_actions',
      description:
        'Detect high-level DeFi actions: swaps, approvals, deposits, withdrawals, bridge transfers, liquidations, flashloans, multicalls.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_failure',
      description:
        'Analyze the root cause of a failed transaction. Returns the revert reason and a human-readable explanation. Only meaningful for failed transactions.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_risks',
      description:
        'Detect security risk patterns: unlimited token approvals, flashloan usage, large ETH/token transfers, DELEGATECALL to unknown contracts, suspicious destinations.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_call_subtree',
      description:
        'Get detailed info for a specific call and its sub-calls, identified by callId. Use to drill into a specific part of the call tree.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'The id of the call node to inspect' },
        },
        required: ['callId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_contract_abi',
      description:
        'Look up the verified ABI for a contract address from Etherscan. Use when you encounter an unrecognized contract to understand its functions.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Contract address (0x...)' },
          networkId: {
            type: 'number',
            description: 'Network ID (1=Ethereum, 56=BSC, 137=Polygon, 10=Optimism, 42161=Arbitrum, 8453=Base, 43114=Avalanche, 59144=Linea, 324=zkSync, 81457=Blast, 534352=Scroll, 250=Fantom, 100=Gnosis, 80094=Berachain)',
          },
        },
        required: ['address', 'networkId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cast_call',
      description:
        'Execute a read-only (static) call to a contract at a specific block using Foundry cast. Useful for querying on-chain state at the exact block the transaction occurred — e.g. checking token allowances or balances at the time of failure.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Contract address to call' },
          functionSignature: {
            type: 'string',
            description: 'Function signature e.g. "allowance(address,address)" or "balanceOf(address)"',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Function arguments as strings',
          },
          networkId: { type: 'number', description: 'Network ID' },
          blockNumber: { type: 'number', description: 'Block number at which to query' },
        },
        required: ['address', 'functionSignature', 'args', 'networkId', 'blockNumber'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cast_run',
      description:
        'Replay the transaction with Foundry cast run to get a low-level execution trace. Use only when you need opcode-level detail beyond what the call tree shows.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulate_with_fix',
      description:
        'Re-simulate the original transaction with a specific fix applied to determine if it would have succeeded. Use this to answer "what would have made this work?" — e.g. more gas, sufficient ETH balance, or a pre-existing token approval.',
      parameters: {
        type: 'object',
        properties: {
          fix_type: {
            type: 'string',
            enum: ['increase_gas', 'set_eth_balance', 'set_erc20_allowance'],
            description:
              'increase_gas: multiply gas limit. set_eth_balance: give sender 100 ETH. set_erc20_allowance: set token allowance to MaxUint256.',
          },
          gas_multiplier: {
            type: 'number',
            description: 'For increase_gas: factor to multiply the original gas by (default 2).',
          },
          eth_amount: {
            type: 'number',
            description: 'For set_eth_balance: ETH amount to set (default 100).',
          },
          token_address: {
            type: 'string',
            description: 'For set_erc20_allowance: the ERC20 token contract address.',
          },
          spender_address: {
            type: 'string',
            description: 'For set_erc20_allowance: the address being approved to spend.',
          },
          mapping_slot: {
            type: 'number',
            description:
              'For set_erc20_allowance: storage slot of _allowances mapping (default 1 for OpenZeppelin tokens; try 0 or 2 for non-standard tokens).',
          },
        },
        required: ['fix_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_revert_source_location',
      description:
        'Fetch verified Solidity source from Etherscan and find the file(s) that define a specific function. Pass the contract address and the exact name of the failing function (e.g. "_payNative", "transfer"). The tool downloads ALL source files and returns every file that contains a definition matching `function <functionName>(`. Use this to locate the exact code that reverted.',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'Full 42-character contract address (0x...) of the contract to look up.',
          },
          functionName: {
            type: 'string',
            description:
              'Name of the failing function to find (e.g. "_payNative", "transfer", "execute"). Do NOT include parentheses or arguments — just the function name.',
          },
        },
        required: ['address', 'functionName'],
      },
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFixResult(r: import('./simulate-fix.service.js').FixResult): string {
  const status = r.wouldSucceed ? '✓ WOULD SUCCEED' : '✗ STILL FAILS';
  const lines = [
    `Fix applied: ${r.fixDescription}`,
    `Result: ${status} (gas used: ${r.gasUsed.toLocaleString()})`,
  ];
  if (!r.wouldSucceed && r.revertReason) lines.push(`Revert reason: "${r.revertReason}"`);
  return lines.join('\n');
}

// ─── Tool executor ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  state: AgentState,
): Promise<string> {
  switch (name) {
    case 'get_call_tree': {
      const revertPath = findRevertPath(state.callTree);
      const revertPathIds = new Set(revertPath);
      const revertOriginId = revertPath.at(-1) ?? '';
      const lines = buildCallTreeText(state.callTree, 0, [], 6, 80, revertPathIds, revertOriginId);
      return lines.join('\n');
    }

    case 'extract_token_flows': {
      const txInfo = state.simulation.transaction.transaction_info;
      const flows = extractTokenFlows(txInfo.asset_changes, txInfo.balance_diff);
      state.tokenFlows = flows;
      if (flows.length === 0) return 'No token flows detected.';
      return flows
        .map(
          f =>
            `${f.type}: ${f.formattedAmount} ${f.tokenSymbol} from ${f.from} to ${f.to}` +
            (f.dollarValue ? ` (~$${f.dollarValue})` : ''),
        )
        .join('\n');
    }

    case 'detect_semantic_actions': {
      const actions = detectSemanticActions(state.callTree, state.tokenFlows);
      state.semanticActions = actions;
      if (actions.length === 0) return 'No high-level DeFi actions detected.';
      return actions
        .map(a => `${a.type}${a.protocol ? ` via ${a.protocol}` : ''}: ${a.description}`)
        .join('\n');
    }

    case 'analyze_failure': {
      if (state.success) return 'Transaction succeeded — no failure to analyze.';
      const reason = analyzeFailure(state.callTree);
      state.failureReason = reason;
      if (!reason) return 'Transaction failed but no revert reason could be decoded.';
      return `Revert reason: "${reason.reason}"\nExplanation: ${reason.explanation}`;
    }

    case 'detect_risks': {
      const flags = detectRisks(state.callTree, state.tokenFlows, state.semanticActions);
      state.riskFlags = flags;
      if (flags.length === 0) return 'No risk flags detected.';
      return flags
        .map(r => `[${r.level.toUpperCase()}] ${r.type}: ${r.description}`)
        .join('\n');
    }

    case 'get_call_subtree': {
      const callId = String(args['callId'] ?? '');
      const node = findCallById(state.callTree, callId);
      if (!node) return `No call found with id: ${callId}`;
      const lines = buildCallTreeText(node, 0, [], 4, 40, new Set(), '');
      return lines.join('\n');
    }

    case 'get_contract_abi': {
      const address = String(args['address'] ?? '');
      const networkId = Number(args['networkId'] ?? state.networkId);
      return getContractAbi(address, networkId);
    }

    case 'cast_call': {
      const address = String(args['address'] ?? '');
      const sig = String(args['functionSignature'] ?? '');
      const callArgs = Array.isArray(args['args']) ? (args['args'] as string[]) : [];
      const networkId = Number(args['networkId'] ?? state.networkId);
      const blockNumber = Number(args['blockNumber'] ?? state.blockNumber);
      return castCall(address, sig, callArgs, networkId, blockNumber);
    }

    case 'cast_run': {
      return castRun(state.txHash, state.networkId);
    }

    case 'simulate_with_fix': {
      const fixType = String(args['fix_type'] ?? '');

      if (fixType === 'increase_gas') {
        const multiplier = typeof args['gas_multiplier'] === 'number' ? args['gas_multiplier'] : 2;
        const result = await simulateWithFix(state.txParams, String(state.networkId), {
          type: 'increase_gas',
          multiplier,
        });
        return formatFixResult(result);
      }

      if (fixType === 'set_eth_balance') {
        const amountEth = typeof args['eth_amount'] === 'number' ? args['eth_amount'] : 100;
        const result = await simulateWithFix(state.txParams, String(state.networkId), {
          type: 'set_eth_balance',
          amountEth,
        });
        return formatFixResult(result);
      }

      if (fixType === 'set_erc20_allowance') {
        const tokenAddress = String(args['token_address'] ?? '');
        const spender = String(args['spender_address'] ?? '');
        if (!tokenAddress || !spender) return 'set_erc20_allowance requires token_address and spender_address.';
        const mappingSlot = typeof args['mapping_slot'] === 'number' ? args['mapping_slot'] : 1;
        const result = await simulateWithFix(state.txParams, String(state.networkId), {
          type: 'set_erc20_allowance',
          tokenAddress,
          spender,
          mappingSlot,
        });
        return formatFixResult(result);
      }

      return `Unknown fix_type: ${fixType}`;
    }

    case 'get_revert_source_location': {
      // Address must be passed explicitly — auto-derivation from the call tree is
      // unreliable (callee can be a selector, precompile, etc.)
      const contractAddress = args['address'] ? String(args['address']) : undefined;
      const functionName    = args['functionName'] ? String(args['functionName']).trim() : undefined;

      if (!contractAddress) {
        return 'Pass the address of the reverting contract explicitly, e.g. get_revert_source_location(address="0x...", functionName="myFunc").';
      }

      if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
        return `"${contractAddress}" is not a valid 42-character Ethereum address.`;
      }

      if (!functionName) {
        return 'Pass the name of the failing function as functionName, e.g. functionName="_payNative".';
      }

      const sourceResult = await getContractSource(contractAddress, state.networkId);
      if (typeof sourceResult === 'string') return sourceResult;

      if (sourceResult.files.length === 0) {
        return `No source files returned for ${contractAddress}.`;
      }

      // Search ALL files for a function definition matching the given name.
      // Match `function <name>(` with an optional visibility/modifier word boundary.
      const pattern = new RegExp(`\\bfunction\\s+${functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`);
      const matchingFiles = sourceResult.files.filter(f => pattern.test(f.content));

      if (matchingFiles.length === 0) {
        const allNames = sourceResult.files.map(f => f.name).join('\n  ');
        return [
          `Contract: ${sourceResult.contractName} (${contractAddress})`,
          `Compiler: ${sourceResult.compilerVersion}`,
          `Total files: ${sourceResult.files.length}`,
          '',
          `No file found containing a definition for function "${functionName}".`,
          '',
          'All files in the compilation unit:',
          `  ${allNames}`,
        ].join('\n');
      }

      const sections: string[] = [
        `Contract: ${sourceResult.contractName} (${contractAddress})`,
        `Compiler: ${sourceResult.compilerVersion}`,
        `Found ${matchingFiles.length} file(s) defining function "${functionName}":`,
        ...matchingFiles.map(f => `  • ${f.name}`),
      ];

      for (const file of matchingFiles) {
        sections.push('', `─── ${file.name} ───`, '```solidity', file.content, '```');
      }

      return sections.join('\n');
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert DeFi transaction analyst with a set of investigation tools.

Your workflow:
1. Always start by calling get_call_tree to understand the transaction structure
2. For FAILED transactions, always call analyze_failure to find the root cause
3. Call extract_token_flows to identify token movements
4. Call detect_semantic_actions to identify DeFi operations (swaps, deposits, approvals, etc.)
5. Always call detect_risks before writing your final answer
6. Use get_contract_abi when you encounter an unrecognized contract address
7. Use cast_call to query on-chain state (balances, allowances) at the transaction block — useful when diagnosing exact failure conditions
8. Use cast_run only when you need low-level opcode trace data
9. For failed transactions, use simulate_with_fix to determine what fix would have made it succeed (try increase_gas, set_eth_balance, or set_erc20_allowance as appropriate to the failure reason)
10. Use get_revert_source_location(address="0x...", functionName="<name>") to locate the exact source code that reverted — it downloads ALL compilation files and returns every file that defines a function with that name. You MUST call this for failed transactions once you know which function reverted (from analyze_failure or the call tree). Pass the exact function name without parentheses.

When you have investigated enough, provide your final analysis. Do NOT mention tools in your answer.

Final answer format:
**Summary**: (2-3 sentences describing what happened)
**Step-by-step**: (numbered list of what occurred in order)
**Token flows**: (omit this section entirely if there are none)
**Risks**: (omit this section entirely if no risk flags were found)
**Failure analysis**: (omit this section entirely if the transaction succeeded)`;

const NETWORK_NAMES: Record<number, string> = {
  1:      'Ethereum Mainnet',
  56:     'BNB Smart Chain',
  100:    'Gnosis',
  137:    'Polygon',
  250:    'Fantom',
  324:    'zkSync Era',
  8453:   'Base',
  10:     'Optimism',
  42161:  'Arbitrum One',
  43114:  'Avalanche C-Chain',
  59144:  'Linea',
  80094:  'Berachain',
  81457:  'Blast',
  534352: 'Scroll',
};

function buildInitialMessage(state: AgentState): string {
  const status = state.success ? 'SUCCESS ✅' : 'FAILED ❌';
  const network = NETWORK_NAMES[state.networkId] ?? `Network ${state.networkId}`;
  return `Analyze this EVM transaction:

Transaction hash: ${state.txHash}
Network: ${network} (id: ${state.networkId})
Status: ${status}
Gas used: ${state.gasUsed.toLocaleString()}
Block: ${state.blockNumber}

Use your tools to investigate. Start with get_call_tree.`;
}

// ─── Log writer ───────────────────────────────────────────────────────────────

function formatConversationLog(messages: OpenAI.Chat.ChatCompletionMessageParam[]): string {
  const lines: string[] = [];
  let turnIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'system') {
      lines.push('─── SYSTEM PROMPT ───────────────────────────────────────────────────────────');
      lines.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      lines.push('');
      continue;
    }

    if (msg.role === 'user') {
      lines.push('─── TURN 0: USER ────────────────────────────────────────────────────────────');
      lines.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      lines.push('');
      continue;
    }

    if (msg.role === 'assistant') {
      turnIndex++;
      const assistantMsg = msg as OpenAI.Chat.ChatCompletionAssistantMessageParam;
      const hasCalls = assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0;
      const isFinal = !hasCalls;

      lines.push(`─── TURN ${turnIndex}: ASSISTANT${isFinal ? ' (FINAL)' : ''} ${'─'.repeat(Math.max(0, 51 - String(turnIndex).length))}`);

      if (hasCalls) {
        lines.push(`[calls ${assistantMsg.tool_calls!.length} tool${assistantMsg.tool_calls!.length > 1 ? 's' : ''}]`);
        for (const tc of assistantMsg.tool_calls!) {
          let argsStr = '';
          try {
            const parsed = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
            const parts = Object.entries(parsed).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
            argsStr = parts.length ? `(${parts.join(', ')})` : '()';
          } catch {
            argsStr = `(${tc.function.arguments})`;
          }
          lines.push(`  → ${tc.function.name}${argsStr}`);
        }
        if (assistantMsg.content) {
          lines.push('');
          lines.push(String(assistantMsg.content));
        }
      } else {
        lines.push(typeof assistantMsg.content === 'string' ? assistantMsg.content : '');
      }
      lines.push('');

      // Collect following tool result messages for this turn
      const toolResults: string[] = [];
      while (i + 1 < messages.length && messages[i + 1]?.role === 'tool') {
        i++;
        const toolMsg = messages[i] as OpenAI.Chat.ChatCompletionToolMessageParam;
        // Find the tool name from the assistant's tool_calls by matching tool_call_id
        const toolName = hasCalls
          ? (assistantMsg.tool_calls!.find(tc => tc.id === toolMsg.tool_call_id)?.function.name ?? 'unknown')
          : 'unknown';
        toolResults.push(`[${toolName}]`);
        const content = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content);
        // Indent each line of the tool output
        toolResults.push(...content.split('\n').map(l => `  ${l}`));
        toolResults.push('');
      }

      if (toolResults.length > 0) {
        lines.push(`─── TURN ${turnIndex}: TOOL RESULTS ${'─'.repeat(Math.max(0, 48 - String(turnIndex).length))}`);
        lines.push(...toolResults);
      }
    }
  }

  return lines.join('\n');
}

async function saveAgentLog(
  txHash: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  llmExplanation: string,
): Promise<void> {
  try {
    await mkdir(LOGS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const short = txHash.slice(0, 10);
    const assistantTurns = messages.filter(m => m.role === 'assistant').length;

    const content = [
      '═'.repeat(80),
      `TX:        ${txHash}`,
      `TIMESTAMP: ${new Date().toISOString()}`,
      `MODEL:     ${config.openrouter.model}`,
      `TURNS:     ${assistantTurns}`,
      '═'.repeat(80),
      '',
      formatConversationLog(messages),
    ].join('\n');

    await writeFile(resolve(LOGS_DIR, `${ts}_${short}.txt`), content, 'utf8');
  } catch (err) {
    console.warn('[agent] Failed to write log:', err);
  }
}

// ─── Progress events ──────────────────────────────────────────────────────────

export interface AgentProgressEvent {
  type: 'tool_call' | 'tool_result' | 'final_answer';
  turn: number;
  toolNames?: string[];   // for tool_call
  toolName?: string;      // for tool_result
  summary?: string;       // for tool_result — first line of the result
}

export type ProgressCallback = (event: AgentProgressEvent) => void;

// ─── Agent loop ───────────────────────────────────────────────────────────────

export async function runAnalysisAgent(
  state: AgentState,
  onProgress?: ProgressCallback,
): Promise<AgentState & { llmExplanation: string }> {
  const openai = getOpenAI();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildInitialMessage(state) },
  ];

  let llmExplanation = 'Analysis could not be completed.';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: config.openrouter.model,
      tools: TOOLS,
      messages,
      temperature: 0.3,
      max_tokens: 1500,
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
        result = await executeTool(
          tc.function.name,
          JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
          state,
        );
      } catch (err) {
        result = `Tool execution error: ${String(err)}`;
      }

      // Emit a short summary (first non-empty line, capped at 120 chars)
      const summary = result.split('\n').find(l => l.trim())?.slice(0, 120) ?? '';
      onProgress?.({ type: 'tool_result', turn: turn + 1, toolName: tc.function.name, summary });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  await saveAgentLog(state.txHash, messages, llmExplanation);

  return { ...state, llmExplanation };
}
