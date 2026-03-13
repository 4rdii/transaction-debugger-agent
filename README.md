# Explorai — AI Transaction Debugger

An agentic multi-chain transaction debugger. Paste a transaction hash, and an LLM agent uses on-chain investigation tools to explain what happened, why it failed, and what would fix it. Supports EVM, Solana, and TON transactions.

## Features

- **Multi-chain EVM support** — Ethereum, Polygon, Arbitrum, Optimism, Base, Linea, BNB Chain, Avalanche, zkSync Era, Blast, Scroll, Fantom, Gnosis, Berachain
- **Solana support** — transaction parsing, instruction decoding via IDL, token flow extraction, known-program and error registries
- **TON support** — transaction traces via TonAPI, Jetton + native TON token flows, known contract/op-code registry (Ston.fi, DeDust, bridges)
- **Auto network detection** — automatically identifies chain from tx hash format (EVM `0x`, TON base64, Solana base58) and probes EVM RPCs to find the exact chain
- **Rango cross-chain swaps** — resolve Rango swap IDs to visualize multi-step bridge/swap routes
- **Agentic analysis** — LLM (configurable via OpenRouter) calls tools autonomously to investigate each transaction
- **Live progress log** — SSE streaming shows tool-by-tool activity so you see the agent working in real time
- **Source code lookup** — fetches verified Solidity via Etherscan V2, searches all compilation files for the failing function definition
- **Fix simulation** — re-simulates with patched state (more gas, ETH balance, token allowance) to confirm the root cause
- **On-chain queries** — reads balances/allowances at the exact block via Foundry `cast call`
- **Telegram Mini App** — mobile-first UI with Telegram authentication and per-user usage tracking
- **MCP server** — use the debugger as tools inside Claude Code

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + TypeScript + Express (port 3001) |
| Frontend | Vite + React + TypeScript (port 5173) |
| Mini App | Vite + React + Tailwind v4 (port 5174) — Telegram Mini App |
| AI | Configurable LLM via OpenRouter (default: claude-haiku-4-5) |
| EVM Simulation | Tenderly REST API |
| Solana RPC | Helius / public Solana endpoints |
| TON RPC | TonAPI (tonapi.io) |
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
- OpenRouter API key

## Setup

```bash
git clone <repo>
cd Debugger
npm install
```

Copy `.env.example` to `packages/backend/.env` and fill in your keys:

```env
# OpenRouter (https://openrouter.ai/keys)
OPEN_ROUTER_API_KEY=sk-or-...
LLM_MODEL=anthropic/claude-haiku-4-5    # optional

# Tenderly (https://dashboard.tenderly.co/account/authorization)
TENDERLY_ACCESS_KEY=...
TENDERLY_ACCOUNT_SLUG=...
TENDERLY_PROJECT_SLUG=...

# Etherscan V2 key — works for all chains (https://etherscan.io/myapikey)
ETHERSCAN_API_KEY=...

# Alchemy key — auto-used for 10 supported chains (optional)
ALCHEMY_API_KEY=...

# Solana — Helius API key for enriched data (optional)
HELIUS_API_KEY=...

# TON — TonAPI key for higher rate limits (optional)
TONAPI_KEY=...

# Telegram Mini App auth (from @BotFather)
BOT_TOKEN=...
```

## Development

```bash
# Terminal 1 — backend
npm run dev:backend

# Terminal 2 — original frontend
npm run dev:frontend

# Terminal 3 — Telegram mini app
npm run dev:mini-app
```

| App | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Mini App | http://localhost:5174 |
| Backend | http://localhost:3001 |

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
Auto-detect chain (parallel RPC probing across all configured chains)
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
  ├── get_revert_source_location (Etherscan V2)
  ├── cast_call / cast_run (Foundry)
  └── simulate_with_fix (Tenderly state overrides)
       │
       ▼
Final analysis streamed via SSE
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

### TON Transactions

```
User pastes TON tx hash
       │
       ▼
TonAPI — fetch trace tree + events
       │
       ▼
ton-normalizer — NormalizedCall tree (MESSAGE/BOUNCE call types)
       │
       ▼
ton-tokenflow — Jetton + native TON transfers from events
       │
       ▼
TON agent loop (with TON-specific system prompt) → final analysis
```

## MCP Server (Claude Code Integration)

The debugger can be used as MCP tools inside [Claude Code](https://claude.com/claude-code).

### Setup

```bash
claude mcp add debugger -- npx tsx packages/mcp/src/index.ts
```

Make sure `packages/backend/.env` is configured. The MCP server imports backend services directly — it does **not** call the HTTP API.

### Available Tools

| Tool | Description |
|---|---|
| `debug_transaction` | Full debug pipeline: call tree, token flows, risk flags, failure analysis |
| `get_call_tree` | Fetch only the call trace |
| `get_token_flows` | Fetch only token transfers and balance changes |
| `get_risk_flags` | Fetch only risk/security flags |
| `resolve_rango_swap` | Look up a Rango cross-chain swap by UUID |

## Project Structure

```
packages/
  shared/         # Shared TypeScript types (tenderly, analysis, api, solana, ton, rango)
  backend/
    src/
      routes/     # debug.route.ts (POST + SSE), qa.route.ts, rango.route.ts
      services/   # agent, etherscan, tenderly, ethers, foundry,
                  # tokenflow, action, failure, risk, normalizer,
                  # simulate-fix, cache, llm, openai, usage,
                  # solana-rpc, solana-normalizer, solana-idl,
                  # solana-tokenflow, solana-agent,
                  # ton-rpc, ton-normalizer, ton-tokenflow, ton-agent,
                  # rango
      registry/   # selectors.ts — known EVM function selectors
                  # solana-programs.ts — known Solana program IDs
                  # solana-errors.ts — known Solana error codes
                  # ton-contracts.ts — known TON contracts & op-codes
      middleware/ # error, telegram-auth (HMAC-SHA256 validation)
      __tests__/  # vitest unit tests
  frontend/
    src/
      components/ # TxInput, AnalysisView, CallTree, TokenFlowPanel,
                  # QAChat, ProgressLog, RangoSwapView
      store/      # analysis.store.ts — useReducer state
      api/        # client.ts — fetch + SSE helpers
  mini-app/
    src/
      app/        # Telegram Mini App — Chat, History, Risk screens
                  # Auth via Telegram WebApp initData
                  # SSE streaming via fetch (for auth headers)
  mcp/            # MCP server (stdio) — exposes debugger as Claude CLI tools
```

## API

### `GET /api/debug/stream?txHash=0x...`

SSE stream. `networkId` is optional — auto-detected from hash format if omitted.

Events:

```jsonc
{ "type": "step",        "message": "Detected network: 1" }
{ "type": "tool_call",   "turn": 1, "toolNames": ["get_call_tree"] }
{ "type": "tool_result", "turn": 1, "toolName": "get_call_tree", "summary": "CALL 0x..." }
{ "type": "complete",    "result": { /* AnalysisResult */ } }
{ "type": "error",       "message": "..." }
```

### `POST /api/debug`

```json
{ "txHash": "0x...", "networkId": "1" }
```

Returns `AnalysisResult`.

### `POST /api/rango/resolve`

```json
{ "swapId": "uuid-string" }
```

Returns cross-chain swap overview with step-by-step route details.

### `POST /api/qa`

```json
{ "question": "Why did the approval fail?", "context": { /* AnalysisResult */ } }
```

Returns `{ "answer": "..." }`.

### `GET /api/auth/check`

Requires `X-Telegram-Init-Data` header. Returns `{ "ok": true, "user": { ... } }`.

### `GET /api/usage`

Requires Telegram auth. Returns per-user and global usage statistics.
