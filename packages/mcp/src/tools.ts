import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  debugTransactionNoLLM,
  getCallTree,
  getTokenFlows,
  getRiskFlags,
  resolveRangoSwap,
  checkToken,
  getContractAbi,
  getContractSource,
  castCall,
  castRun,
  simulateFixForTx,
} from './pipeline.js';
import type { DebugData, TokenCheckResult } from './pipeline.js';
import type { NormalizedCall } from '@debugger/shared';

const MAX_TREE_DEPTH = 6;
const MAX_TREE_LINES = 150;

// ── Call tree formatting ──────────────────────────────────────────────

/** Does any node in this subtree have a revert? */
function hasRevert(node: NormalizedCall): boolean {
  if (!node.success) return true;
  return (node.children ?? []).some((c) => hasRevert(c));
}

/** Format a NormalizedCall tree as indented text with depth/line limits.
 *  Reverted paths are always shown in full (no depth/line cap). */
function formatCallTree(
  node: NormalizedCall,
  depth = 0,
  ctx: { lines: number } = { lines: 0 },
  onRevertPath = false,
): string {
  const revertPath = onRevertPath || !node.success;

  if (!revertPath && ctx.lines >= MAX_TREE_LINES) return '';

  const indent = '  '.repeat(depth);
  const status = node.success ? '' : ' [REVERTED]';
  const fn = node.functionName ?? node.functionSelector ?? '(unknown)';
  const contract = node.contractName ? `${node.contractName}.` : '';
  const gas = node.gasUsed ? ` (${node.gasUsed.toLocaleString()} gas)` : '';
  const revert = node.revertReason ? ` — "${node.revertReason}"` : '';
  const protocol = node.protocol ? ` [${node.protocol}]` : '';
  const id = node.id ? ` @${node.id}` : '';
  const line = `${indent}${node.callType} ${contract}${fn}${protocol}${gas}${status}${revert}${id}`;
  ctx.lines++;

  const result = [line];
  const children = node.children ?? [];

  if (!revertPath && depth >= MAX_TREE_DEPTH && children.length > 0) {
    const revertChildren = children.filter((c) => hasRevert(c));
    if (revertChildren.length > 0) {
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

/** Find a call node by its id (breadth-first). */
function findCallById(node: NormalizedCall, id: string): NormalizedCall | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findCallById(child, id);
    if (found) return found;
  }
  return undefined;
}

// ── Full debug data formatter ─────────────────────────────────────────

function formatDebugData(data: DebugData): string {
  const sections: string[] = [];

  sections.push(`Transaction: ${data.txHash}`);
  sections.push(`Network: ${data.networkId}`);
  sections.push(`Status: ${data.success ? 'SUCCESS' : 'FAILED'}`);
  sections.push(`Gas used: ${data.gasUsed.toLocaleString()}`);
  sections.push(`Block: ${data.blockNumber}`);
  sections.push('');

  sections.push('== CALL TREE ==');
  sections.push('(Each node shows: CALL ContractName.functionName [protocol] (gas) [REVERTED] — "reason" @callId)');
  sections.push('(Use get_call_subtree(callId) to expand any node further)');
  sections.push(formatCallTree(data.callTree));
  sections.push('');

  if (data.tokenFlows.length > 0) {
    sections.push('== TOKEN FLOWS ==');
    for (const f of data.tokenFlows) {
      const dollar = f.dollarValue ? ` (~$${f.dollarValue})` : '';
      sections.push(`${f.type}: ${f.formattedAmount} ${f.tokenSymbol} from ${f.from} → ${f.to}${dollar}`);
    }
    sections.push('');
  }

  if (data.semanticActions.length > 0) {
    sections.push('== ACTIONS ==');
    for (const a of data.semanticActions) {
      sections.push(`${a.type}${a.protocol ? ` via ${a.protocol}` : ''}: ${a.description}`);
    }
    sections.push('');
  }

  if (data.failureReason) {
    sections.push('== FAILURE ANALYSIS ==');
    sections.push(`Revert reason: "${data.failureReason.reason}"`);
    sections.push(`Explanation: ${data.failureReason.explanation}`);
    sections.push('');
  }

  if (data.riskFlags.length > 0) {
    sections.push('== RISK FLAGS ==');
    for (const r of data.riskFlags) {
      sections.push(`[${r.level.toUpperCase()}] ${r.type}: ${r.description}`);
    }
    sections.push('');
  }

  sections.push('== INVESTIGATION WORKFLOW ==');
  sections.push('You are the analyst. No LLM runs inside these tools — all data is raw.');
  sections.push('Call tools iteratively across multiple turns as needed:');
  sections.push('');
  sections.push('  get_call_subtree(txHash, networkId, callId)');
  sections.push('    → Expand any @callId from the tree above for full depth + children');
  sections.push('');
  sections.push('  get_contract_abi(address, networkId)');
  sections.push('    → Look up verified ABI for any unrecognised contract');
  sections.push('');
  sections.push('  get_revert_source_location(address, networkId, functionName)');
  sections.push('    → Fetch verified Solidity source and find the reverting function code');
  sections.push('    → EVM only (Ethereum, Polygon, Arbitrum, Base, BSC, Optimism, etc.)');
  sections.push('');
  sections.push('  cast_call(address, functionSignature, args, networkId, blockNumber)');
  sections.push('    → Query on-chain state (allowances, balances) at the exact block of the tx');
  sections.push('    → EVM only');
  sections.push('');
  sections.push('  cast_run(txHash, networkId)');
  sections.push('    → Opcode-level replay via Foundry for deep EVM debugging');
  sections.push('    → EVM only');
  sections.push('');
  sections.push('  simulate_with_fix(txHash, networkId, fix_type, ...)');
  sections.push('    → Re-simulate with increase_gas / set_eth_balance / set_erc20_allowance');
  sections.push('    → Answers "what would have made this succeed?"');
  sections.push('    → EVM only');
  sections.push('');
  sections.push('Batch independent tool calls in a single turn for efficiency.');
  sections.push('Iterate until you have a complete root-cause explanation.');

  return sections.join('\n');
}

// ── Tool registration ─────────────────────────────────────────────────

export function registerTools(server: McpServer): void {

  // ── debug_transaction ────────────────────────────────────────────────
  server.tool(
    'debug_transaction',
    [
      'START HERE. Fetch, simulate, and analyse a transaction: builds the call tree, extracts token flows,',
      'detects DeFi actions, identifies failure reasons and risk flags. Returns structured text for you to interpret.',
      'No LLM is called internally — you are the analyst.',
      '',
      'Supported networks:',
      '  EVM:    "1" (Ethereum) "56" (BSC) "137" (Polygon) "10" (Optimism) "42161" (Arbitrum)',
      '          "8453" (Base) "43114" (Avalanche) "59144" (Linea) "324" (zkSync) "81457" (Blast)',
      '          "534352" (Scroll) "250" (Fantom) "100" (Gnosis) "80094" (Berachain)',
      '  Solana: "solana-mainnet" "solana-devnet"',
      '  TON:    "ton-mainnet" "ton-testnet"',
      '',
      'After calling this tool, use the granular tools (get_call_subtree, get_contract_abi,',
      'get_revert_source_location, cast_call, cast_run, simulate_with_fix) to drill deeper.',
      'You can call multiple tools in parallel per turn.',
    ].join('\n'),
    {
      txHash: z.string().describe(
        'Transaction hash. EVM: 0x-prefixed hex. Solana: base58 signature. TON: base64 or hex.',
      ),
      networkId: z.string().describe(
        'Network ID — see tool description for full list.',
      ),
    },
    async ({ txHash, networkId }) => {
      const data = await debugTransactionNoLLM(txHash, networkId);
      return {
        content: [{ type: 'text', text: formatDebugData(data) }],
      };
    },
  );

  // ── get_call_subtree ─────────────────────────────────────────────────
  server.tool(
    'get_call_subtree',
    [
      'Expand a specific call node from the call tree in full depth.',
      'Use the @callId values shown in debug_transaction output (e.g. "0.1.3").',
      'Returns the full subtree rooted at that call, with no depth or line limit.',
      'Useful for drilling into a deeply nested revert or a large contract interaction.',
      'Works for all chains (EVM, Solana, TON).',
    ].join('\n'),
    {
      txHash: z.string().describe('Transaction hash'),
      networkId: z.string().describe('Network ID (e.g. "1", "8453", "solana-mainnet", "ton-mainnet")'),
      callId: z.string().describe('Call node ID from the @callId annotation in the call tree (e.g. "0.1.3")'),
    },
    async ({ txHash, networkId, callId }) => {
      const tree = await getCallTree(txHash, networkId);
      const node = findCallById(tree, callId);
      if (!node) {
        return {
          content: [{ type: 'text', text: `No call found with id "${callId}". Check the @callId values in the debug_transaction output.` }],
        };
      }
      const formatted = formatCallTree(node, 0, { lines: 0 }, false);
      return {
        content: [{ type: 'text', text: formatted }],
      };
    },
  );

  // ── get_call_tree ────────────────────────────────────────────────────
  server.tool(
    'get_call_tree',
    [
      'Fetch only the call tree of a transaction — no token flows, no risk analysis.',
      'Faster than debug_transaction when you only need the execution trace.',
      'Each node includes contract name, function, gas, revert reason, and @callId.',
      'Works for all chains (EVM, Solana, TON).',
    ].join('\n'),
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

  // ── get_token_flows ──────────────────────────────────────────────────
  server.tool(
    'get_token_flows',
    [
      'Extract all token transfers from a transaction: ERC20, ERC721, native ETH/SOL/TON.',
      'Returns from, to, token symbol, formatted amount, and dollar value for each flow.',
      'Works for all chains (EVM, Solana, TON).',
    ].join('\n'),
    {
      txHash: z.string().describe('Transaction hash'),
      networkId: z.string().describe('Network ID (e.g. "1", "137", "solana-mainnet", "ton-mainnet")'),
    },
    async ({ txHash, networkId }) => {
      const flows = await getTokenFlows(txHash, networkId);
      if (flows.length === 0) {
        return { content: [{ type: 'text', text: 'No token flows detected in this transaction.' }] };
      }
      const summary = flows
        .map((f) => `${f.type}: ${f.formattedAmount} ${f.tokenSymbol} from ${f.from} → ${f.to}`)
        .join('\n');
      return {
        content: [{ type: 'text', text: summary }],
      };
    },
  );

  // ── get_risk_flags ───────────────────────────────────────────────────
  server.tool(
    'get_risk_flags',
    [
      'Detect security risk flags in a transaction:',
      'unlimited approvals, large value transfers, flash loans,',
      'delegatecalls to untrusted contracts, reentrancy patterns, etc.',
      'Works for all chains (EVM, Solana, TON).',
    ].join('\n'),
    {
      txHash: z.string().describe('Transaction hash'),
      networkId: z.string().describe('Network ID (e.g. "1", "137", "solana-mainnet", "ton-mainnet")'),
    },
    async ({ txHash, networkId }) => {
      const flags = await getRiskFlags(txHash, networkId);
      if (flags.length === 0) {
        return { content: [{ type: 'text', text: 'No risk flags detected in this transaction.' }] };
      }
      const summary = flags
        .map((f) => `[${f.level.toUpperCase()}] ${f.type}: ${f.description}`)
        .join('\n');
      return {
        content: [{ type: 'text', text: summary }],
      };
    },
  );

  // ── resolve_rango_swap ───────────────────────────────────────────────
  server.tool(
    'resolve_rango_swap',
    [
      'Look up a Rango cross-chain swap by its swap ID.',
      'Returns the swap route overview: source/destination tokens, intermediate steps,',
      'per-step status, and the individual transaction hashes that can be debugged',
      'with debug_transaction.',
    ].join('\n'),
    {
      swapId: z.string().describe('Rango swap ID (UUID from the Rango explorer URL)'),
    },
    async ({ swapId }) => {
      const overview = await resolveRangoSwap(swapId);
      const header = `${overview.fromToken.amount} ${overview.fromToken.symbol} (${overview.fromToken.chain}) → ${overview.toToken.amount} ${overview.toToken.symbol} (${overview.toToken.chain})`;
      const stepLines = overview.steps
        .map(
          (s) =>
            `  Step ${s.stepIndex}: ${s.from.symbol} (${s.from.chain}) → ${s.to.symbol} (${s.to.chain}) via ${s.swapper.title} [${s.status}]`,
        )
        .join('\n');
      const txLines = overview.transactions
        .map(
          (t) =>
            `  ${t.chainDisplayName}: ${t.txHash}${t.analyzable ? '' : ' (not analyzable)'}`,
        )
        .join('\n');
      const summary = `Swap: ${header}\nStatus: ${overview.status}\n\nSteps:\n${stepLines}\n\nTransactions:\n${txLines}\n\nNext: call debug_transaction on each analyzable tx hash above.`;
      return {
        content: [{ type: 'text', text: summary }],
      };
    },
  );

  // ── check_token ──────────────────────────────────────────────────────
  server.tool(
    'check_token',
    [
      'Analyse a token contract for malicious or quirky patterns:',
      'fee-on-transfer, honeypot sell toggles, blacklists, max-tx limits,',
      'hidden mints, rebase mechanics, pausability, and more.',
      'Fetches verified source from Etherscan and runs static pattern detection.',
      'EVM only (Ethereum, Polygon, Arbitrum, Base, BSC, Optimism, etc.).',
    ].join('\n'),
    {
      tokenAddress: z.string().describe('Token contract address (0x...)'),
      networkId: z.string().describe(
        'EVM network ID: "1" (Ethereum) "137" (Polygon) "42161" (Arbitrum) "10" (Optimism) "8453" (Base) "56" (BSC) etc.',
      ),
    },
    async ({ tokenAddress, networkId }) => {
      const result = await checkToken(tokenAddress, Number(networkId));

      const lines: string[] = [];
      lines.push(`Token: ${tokenAddress} (network ${networkId})`);
      lines.push(`Contract: ${result.contractName ?? 'Unknown'}`);
      lines.push(`Verified: ${result.verified ? 'Yes' : 'No'}`);
      lines.push('');

      if (result.flags.length === 0) {
        lines.push('No flags detected.');
      } else {
        lines.push(`== TOKEN FLAGS (${result.flags.length}) ==`);
        for (const f of result.flags) {
          lines.push(`[${f.level.toUpperCase()}] ${f.type}: ${f.description}`);
          if (f.evidence) {
            lines.push(`  Evidence: "${f.evidence}"`);
          }
        }
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    },
  );

  // ── get_contract_abi ─────────────────────────────────────────────────
  server.tool(
    'get_contract_abi',
    [
      'Look up the verified ABI for a contract address from Etherscan.',
      'Returns a list of all public functions with their signatures.',
      'Use when you encounter an unrecognised contract to understand what it does.',
      'EVM only. Supported chains: Ethereum, Polygon, Arbitrum, Base, BSC, Optimism,',
      'Avalanche, Linea, zkSync, Blast, Scroll, Fantom, Gnosis, Berachain.',
    ].join('\n'),
    {
      address: z.string().describe('Contract address (0x...)'),
      networkId: z.string().describe(
        'EVM network ID (e.g. "1" for Ethereum, "8453" for Base, "42161" for Arbitrum)',
      ),
    },
    async ({ address, networkId }) => {
      const result = await getContractAbi(address, Number(networkId));
      return {
        content: [{ type: 'text', text: result }],
      };
    },
  );

  // ── get_revert_source_location ───────────────────────────────────────
  server.tool(
    'get_revert_source_location',
    [
      'Fetch verified Solidity source from Etherscan and find the file(s) that define',
      'a specific function. Pass the contract address and the exact function name.',
      'The tool downloads ALL source files and returns every file containing',
      'a definition matching `function <functionName>(` — use this to read the exact',
      'code that reverted and understand why.',
      'EVM only.',
    ].join('\n'),
    {
      address: z.string().describe('Full 42-character contract address (0x...) of the contract to look up'),
      networkId: z.string().describe('EVM network ID (e.g. "1", "8453", "42161")'),
      functionName: z.string().describe(
        'Name of the function to find — do NOT include parentheses or args, just the name (e.g. "_payNative", "transfer", "execute")',
      ),
    },
    async ({ address, networkId, functionName }) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return {
          content: [{ type: 'text', text: `"${address}" is not a valid 42-character Ethereum address.` }],
        };
      }

      const sourceResult = await getContractSource(address, Number(networkId));
      if (typeof sourceResult === 'string') {
        return { content: [{ type: 'text', text: sourceResult }] };
      }

      if (sourceResult.files.length === 0) {
        return { content: [{ type: 'text', text: `No source files returned for ${address}.` }] };
      }

      const pattern = new RegExp(
        `\\bfunction\\s+${functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`,
      );
      const matchingFiles = sourceResult.files.filter((f) => pattern.test(f.content));

      if (matchingFiles.length === 0) {
        const allNames = sourceResult.files.map((f) => f.name).join('\n  ');
        return {
          content: [
            {
              type: 'text',
              text: [
                `Contract: ${sourceResult.contractName} (${address})`,
                `Compiler: ${sourceResult.compilerVersion}`,
                `Total files: ${sourceResult.files.length}`,
                '',
                `No file found containing a definition for function "${functionName}".`,
                '',
                'All files in the compilation unit:',
                `  ${allNames}`,
              ].join('\n'),
            },
          ],
        };
      }

      const sections: string[] = [
        `Contract: ${sourceResult.contractName} (${address})`,
        `Compiler: ${sourceResult.compilerVersion}`,
        `Found ${matchingFiles.length} file(s) defining function "${functionName}":`,
        ...matchingFiles.map((f) => `  • ${f.name}`),
      ];

      for (const file of matchingFiles) {
        sections.push('', `─── ${file.name} ───`, '```solidity', file.content, '```');
      }

      return {
        content: [{ type: 'text', text: sections.join('\n') }],
      };
    },
  );

  // ── cast_call ────────────────────────────────────────────────────────
  server.tool(
    'cast_call',
    [
      'Execute a read-only (static) call to a contract at a specific block using Foundry cast.',
      'Use to query on-chain state (token allowances, balances, slot values) at the',
      'exact block the transaction occurred — crucial for understanding why a tx failed.',
      'EVM only.',
    ].join('\n'),
    {
      address: z.string().describe('Contract address to call (0x...)'),
      functionSignature: z.string().describe(
        'Function signature e.g. "allowance(address,address)" or "balanceOf(address)"',
      ),
      args: z.array(z.string()).describe('Function arguments as strings'),
      networkId: z.string().describe('EVM network ID (e.g. "1", "8453", "42161")'),
      blockNumber: z.number().describe('Block number at which to query (use blockNumber from debug_transaction output)'),
    },
    async ({ address, functionSignature, args, networkId, blockNumber }) => {
      const result = await castCall(address, functionSignature, args, Number(networkId), blockNumber);
      return {
        content: [{ type: 'text', text: result }],
      };
    },
  );

  // ── cast_run ─────────────────────────────────────────────────────────
  server.tool(
    'cast_run',
    [
      'Replay the transaction with Foundry cast run to get an opcode-level execution trace.',
      'Use only when you need low-level detail beyond what the call tree provides',
      '— e.g. to see exact SLOAD/SSTORE values or trace a STATICCALL into a precompile.',
      'EVM only. Can be slow for complex transactions.',
    ].join('\n'),
    {
      txHash: z.string().describe('Transaction hash (0x...)'),
      networkId: z.string().describe('EVM network ID (e.g. "1", "8453", "42161")'),
    },
    async ({ txHash, networkId }) => {
      const result = await castRun(txHash, Number(networkId));
      return {
        content: [{ type: 'text', text: result }],
      };
    },
  );

  // ── simulate_with_fix ────────────────────────────────────────────────
  server.tool(
    'simulate_with_fix',
    [
      'Re-simulate the transaction with a specific fix applied, to determine if it would have succeeded.',
      'Use this to answer "what would have made this work?".',
      '',
      'fix_type options:',
      '  increase_gas          — multiply the original gas limit (use gas_multiplier, default 2x)',
      '  set_eth_balance       — give the sender 100 ETH before the tx (use eth_amount to override)',
      '  set_erc20_allowance   — set a token allowance to MaxUint256 before the tx',
      '                          (requires token_address and spender_address)',
      '',
      'EVM only.',
    ].join('\n'),
    {
      txHash: z.string().describe('Transaction hash (0x...)'),
      networkId: z.string().describe('EVM network ID (e.g. "1", "8453", "42161")'),
      fix_type: z.enum(['increase_gas', 'set_eth_balance', 'set_erc20_allowance']).describe(
        'Which fix to apply',
      ),
      gas_multiplier: z.number().optional().describe(
        'For increase_gas: factor to multiply the original gas by (default 2)',
      ),
      eth_amount: z.number().optional().describe(
        'For set_eth_balance: ETH amount to set (default 100)',
      ),
      token_address: z.string().optional().describe(
        'For set_erc20_allowance: the ERC20 token contract address',
      ),
      spender_address: z.string().optional().describe(
        'For set_erc20_allowance: the address being approved to spend',
      ),
      mapping_slot: z.number().optional().describe(
        'For set_erc20_allowance: storage slot of _allowances mapping (default 1 for OZ tokens; try 0 or 2 for non-standard)',
      ),
    },
    async ({ txHash, networkId, fix_type, gas_multiplier, eth_amount, token_address, spender_address, mapping_slot }) => {
      let fix: Parameters<typeof simulateFixForTx>[2];

      if (fix_type === 'increase_gas') {
        fix = { type: 'increase_gas', multiplier: gas_multiplier };
      } else if (fix_type === 'set_eth_balance') {
        fix = { type: 'set_eth_balance', amountEth: eth_amount };
      } else {
        if (!token_address || !spender_address) {
          return {
            content: [{ type: 'text', text: 'set_erc20_allowance requires token_address and spender_address.' }],
          };
        }
        fix = {
          type: 'set_erc20_allowance',
          tokenAddress: token_address,
          spender: spender_address,
          mappingSlot: mapping_slot,
        };
      }

      const result = await simulateFixForTx(txHash, networkId, fix);
      const status = result.wouldSucceed ? '✓ WOULD SUCCEED' : '✗ STILL FAILS';
      const lines = [
        `Fix applied: ${result.fixDescription}`,
        `Result: ${status} (gas used: ${result.gasUsed.toLocaleString()})`,
      ];
      if (!result.wouldSucceed && result.revertReason) {
        lines.push(`Revert reason: "${result.revertReason}"`);
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    },
  );
}
