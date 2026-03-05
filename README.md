# AI Transaction Debugger

An agentic multi-chain transaction debugger. Paste a transaction hash, and an LLM agent uses a set of on-chain investigation tools to explain what happened, why it failed, and what would have fixed it. Supports both EVM and Solana transactions.

## Features

- **Multi-chain EVM support** — Ethereum, Polygon, Arbitrum, Optimism, Base, Linea, BNB Chain, Avalanche, zkSync Era, Blast, Scroll, Fantom, Gnosis, Berachain
- **Solana support** — transaction parsing, instruction decoding via IDL, token flow extraction, known-program and error registries
- **Rango cross-chain swaps** — resolve Rango swap IDs to visualize multi-step bridge/swap routes
- **Agentic analysis** — GPT-4o (via OpenRouter or direct OpenAI) calls tools autonomously to investigate each transaction
- **Live progress log** — SSE streaming shows tool-by-tool activity so you see the agent working in real time
- **Source code lookup** — fetches verified Solidity via Etherscan V2, searches all compilation files for the failing function definition
- **Fix simulation** — re-simulates with patched state (more gas, ETH balance, token allowance) to confirm the root cause
- **On-chain queries** — reads balances/allowances at the exact block via Foundry `cast call`

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + TypeScript + Express (port 3001) |
| Frontend | Vite + React + TypeScript (port 5173) |
| AI | GPT-4o via OpenRouter or direct OpenAI API |
| EVM Simulation | Tenderly REST API |
| Solana RPC | Helius / public Solana endpoints |
| Source lookup | Etherscan V2 API |
| On-chain reads | Foundry `cast` |
| Testing | Vitest |
| CI/CD | GitHub Actions |
| Monorepo | npm workspaces |

## Prerequisites

- Node.js 20+
- [Foundry](https://getfoundry.sh/) installed (`cast` must be in PATH)
- Tenderly account (free tier works)
- Etherscan API key
- OpenRouter API key (or OpenAI API key)

## Setup

```bash
git clone <repo>
cd Debugger
npm install
```

Copy `.env.example` to `.env` in the project root and fill in your keys:

```env
# OpenRouter (https://openrouter.ai/keys)
OPEN_ROUTER_API_KEY=sk-or-...
LLM_MODEL=openai/gpt-4o          # optional, defaults to openai/gpt-4o

# Or use OpenAI directly
# OPENAI_API_KEY=sk-...

# Tenderly (https://dashboard.tenderly.co/account/authorization)
TENDERLY_ACCESS_KEY=...
TENDERLY_ACCOUNT_SLUG=...
TENDERLY_PROJECT_SLUG=...

# Etherscan V2 key — works for all chains (https://etherscan.io/myapikey)
ETHERSCAN_API_KEY=...

# Alchemy key — auto-used for 10 supported chains (optional)
ALCHEMY_API_KEY=...

# Solana — Helius API key for enriched data (optional, free tier available)
HELIUS_API_KEY=...

# Optional per-chain RPC overrides (take priority over Alchemy)
# RPC_URL_1=https://...
# RPC_URL_137=https://...
```

## Development

```bash
# Terminal 1 — backend
npm run dev:backend

# Terminal 2 — frontend
npm run dev:frontend
```

Open [http://localhost:5173](http://localhost:5173).

## Testing

```bash
npm test
```

## How It Works

### EVM Transactions

```
User pastes tx hash
       │
       ▼
ethers.js — fetch raw tx params
       │
       ▼
Tenderly /simulate — full call trace + asset changes
       │
       ▼
normalizer — NormalizedCall tree
       │
       ▼
LLM agent loop (up to 12 turns)
  ├── get_call_tree
  ├── analyze_failure
  ├── extract_token_flows
  ├── detect_semantic_actions
  ├── detect_risks
  ├── get_contract_abi (Etherscan)
  ├── get_revert_source_location (Etherscan V2 — searches by function name)
  ├── cast_call / cast_run (Foundry)
  └── simulate_with_fix (Tenderly state overrides)
       │
       ▼
Final analysis streamed via SSE → frontend ProgressLog → AnalysisView
```

### Solana Transactions

```
User pastes Solana tx signature
       │
       ▼
Solana RPC / Helius — fetch parsed transaction
       │
       ▼
solana-normalizer — NormalizedInstruction tree
       │
       ▼
solana-idl — decode instruction data via on-chain IDLs
       │
       ▼
solana-tokenflow — extract token transfers and balance changes
       │
       ▼
Solana agent loop → final analysis
```

## MCP Server (Claude Code Integration)

The debugger can be used as an MCP tool directly inside [Claude Code](https://claude.com/claude-code). Instead of the web UI, Claude analyzes transactions itself using the raw call tree, token flows, and risk flags.

### Setup

```bash
# Register the MCP server with Claude Code
claude mcp add debugger -- npx tsx packages/mcp/src/index.ts
```

Make sure your `.env` is configured (same keys as above). The MCP server imports backend services directly — it does **not** call your backend HTTP API.

### Available Tools

| Tool | Description |
|---|---|
| `debug_transaction` | Full debug pipeline: call tree, token flows, risk flags, failure analysis — returned as structured text for Claude to interpret |
| `get_call_tree` | Fetch only the call trace (no LLM, no token flows) |
| `get_token_flows` | Fetch only token transfers and balance changes |
| `get_risk_flags` | Fetch only risk/security flags |
| `resolve_rango_swap` | Look up a Rango cross-chain swap by its UUID — returns route steps and per-step tx hashes |

### Usage

Once registered, just ask Claude Code to debug a transaction:

```
> debug 0xabc123... on ethereum
> what happened in this rango swap 87e03b2b-759c-460c-9997-0bc2a4cf994b
```

Claude will call the appropriate MCP tools and analyze the results.

## Project Structure

```
packages/
  shared/         # Shared TypeScript types (tenderly, analysis, api, solana, rango)
  backend/
    src/
      routes/     # debug.route.ts (POST + SSE), qa.route.ts, rango.route.ts
      services/   # agent, etherscan, tenderly, ethers, foundry,
                  # tokenflow, action, failure, risk, normalizer,
                  # simulate-fix, cache, llm, openai,
                  # solana-rpc, solana-normalizer, solana-idl,
                  # solana-tokenflow, solana-agent, rango
      registry/   # selectors.ts — known 4-byte function selectors
                  # solana-programs.ts — known Solana program IDs
                  # solana-errors.ts — known Solana error codes
      __tests__/  # vitest unit tests
  frontend/
    src/
      components/ # TxInput, AnalysisView, CallTree, TokenFlowPanel,
                  # QAChat, ProgressLog, RangoSwapView
      store/      # analysis.store.ts — useReducer state
      api/        # client.ts — fetch + SSE helpers
```

## API

### `GET /api/debug/stream?txHash=0x...&networkId=1`

SSE stream. Events:

```jsonc
{ "type": "tool_call",   "turn": 1, "toolNames": ["get_call_tree"] }
{ "type": "tool_result", "turn": 1, "toolName": "get_call_tree", "summary": "CALL 0x..." }
{ "type": "complete",    "result": { /* AnalysisResult */ } }
{ "type": "error",       "message": "..." }
```

### `POST /api/debug`

```json
{ "txHash": "0x...", "networkId": 1 }
```

Returns `AnalysisResult` (same as SSE `complete.result`).

### `POST /api/rango/resolve`

```json
{ "swapId": "uuid-string" }
```

Returns cross-chain swap overview with step-by-step route details.

### `POST /api/qa`

```json
{ "txHash": "0x...", "question": "Why did the approval fail?" }
```

Returns `{ "answer": "..." }`.
