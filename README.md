# AI Transaction Debugger

An agentic EVM transaction debugger. Paste a transaction hash, and an LLM agent uses a set of on-chain investigation tools to explain what happened, why it failed, and what would have fixed it.

## Features

- **Multi-chain support** — Ethereum, Polygon, Arbitrum, Optimism, Base, Linea, Berachain
- **Agentic analysis** — GPT-4o (via OpenRouter) calls tools autonomously to investigate each transaction
- **Live progress log** — SSE streaming shows tool-by-tool activity so you see the agent working in real time
- **Source code lookup** — fetches verified Solidity via Etherscan V2, searches all compilation files for the failing function definition
- **Fix simulation** — re-simulates with patched state (more gas, ETH balance, token allowance) to confirm the root cause
- **On-chain queries** — reads balances/allowances at the exact block via Foundry `cast call`

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + TypeScript + Express (port 3001) |
| Frontend | Vite + React + TypeScript (port 5173) |
| AI | GPT-4o via OpenRouter |
| Simulation | Tenderly REST API |
| Source lookup | Etherscan V2 API |
| On-chain reads | Foundry `cast` |
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

Create `packages/backend/.env`:

```env
# OpenRouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openai/gpt-4o

# Tenderly
TENDERLY_ACCESS_KEY=...
TENDERLY_ACCOUNT_SLUG=...
TENDERLY_PROJECT_SLUG=...

# Etherscan (V2 key works for all chains including Berachain)
ETHERSCAN_API_KEY=...

# RPC endpoints
RPC_URL_1=https://eth-mainnet.g.alchemy.com/v2/...
RPC_URL_137=https://polygon-mainnet.g.alchemy.com/v2/...
RPC_URL_42161=https://arb-mainnet.g.alchemy.com/v2/...
RPC_URL_10=https://opt-mainnet.g.alchemy.com/v2/...
RPC_URL_8453=https://base-mainnet.g.alchemy.com/v2/...
```

## Development

```bash
# Terminal 1 — backend
npm run dev:backend

# Terminal 2 — frontend
npm run dev:frontend
```

Open [http://localhost:5173](http://localhost:5173).

## How It Works

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

## Project Structure

```
packages/
  shared/         # Shared TypeScript types (tenderly, analysis, api)
  backend/
    src/
      routes/     # debug.route.ts (POST + SSE), qa.route.ts
      services/   # agent, etherscan, tenderly, ethers, foundry,
                  # tokenflow, action, failure, risk, normalizer,
                  # simulate-fix, cache, llm
      registry/   # selectors.ts — known 4-byte function selector map
  frontend/
    src/
      components/ # TxInput, AnalysisView, CallTree, TokenFlowPanel,
                  # QAChat, ProgressLog
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

### `POST /api/qa`

```json
{ "txHash": "0x...", "question": "Why did the approval fail?" }
```

Returns `{ "answer": "..." }`.
