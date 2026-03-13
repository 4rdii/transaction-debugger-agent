# Explorai — AI Transaction Agent for TON

> **Try it now**: [Open in Telegram](https://t.me/ExploraiAgentBot/app)

Explorai is a Telegram-native AI agent that debugs and explains blockchain transactions. Paste any TON transaction hash and get a plain-English breakdown of what happened — token flows, risk flags, failure analysis, and more. Built as a Telegram Mini App with native authentication.

## What It Does

1. **Paste a TON transaction hash** into the chat
2. The AI agent automatically fetches the full trace tree and token events via TonAPI
3. It runs an agentic analysis loop — calling tools to inspect the call tree, extract Jetton/TON transfers, detect risks, and identify failures
4. You get a structured report with an AI-generated explanation, streamed in real time

## TON Integration

- **TonAPI** — fetches transaction traces (`/v2/traces`) and events (`/v2/events`) for full transaction reconstruction
- **TON call tree normalization** — converts TonAPI trace format into a unified call tree with `MESSAGE` and `BOUNCE` call types
- **Jetton + native TON token flows** — extracts all Jetton transfers and native TON value movements from transaction events
- **Known contract registry** — identifies Ston.fi, DeDust, TON bridges, popular Jettons, and decodes TON op-codes for human-readable output
- **TON-specific AI agent** — dedicated system prompt with TON domain knowledge (message routing, bounced messages, Jetton standard, op-codes)
- **Auto network detection** — recognizes TON transaction hashes (base64 with `+/=` or 64-char hex) and routes to the TON pipeline automatically

## Telegram Mini App

- **Native Telegram auth** — HMAC-SHA256 validation of `initData` from `telegram-web-app.js`, no separate login required
- **Per-user usage tracking** — tracks analyses and questions per Telegram user
- **Mobile-first UI** — dark theme, chat-style interface designed for Telegram's Mini App viewport
- **Real-time streaming** — SSE via fetch (with auth headers) shows the agent's tool calls as they happen
- **Screens**: Chat (main analysis), History (past transactions), Risk Detail (expandable risk flags)

## Multi-Chain Support

While TON is the primary focus, Explorai also supports:

- **EVM chains** (14 networks) — Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, and more via Tenderly simulation + Etherscan source lookup
- **Solana** — transaction parsing, IDL-based instruction decoding, token flow extraction via Helius
The agent auto-detects the chain from the hash format and routes to the correct pipeline.

## Architecture

```
Telegram Bot (@ExploraiBot)
         │
         ▼
  Mini App (Vercel)
    Vite + React + Tailwind v4
    Telegram WebApp auth
         │
         ▼ SSE stream
  Backend (Express API)
    ├── TON pipeline
    │     TonAPI → trace normalizer → token flow extractor → AI agent
    ├── EVM pipeline
    │     Tenderly → call normalizer → token flows → AI agent
    └── Solana pipeline
          Helius/RPC → instruction normalizer → IDL decoder → AI agent
         │
         ▼
  LLM (Claude Haiku via OpenRouter)
    Agentic loop with tools: call tree, token flows,
    risk detection, failure analysis, source lookup
```

### TON Pipeline Detail

```
TON tx hash
     │
     ▼
TonAPI /v2/traces/{hash} — full message trace tree
TonAPI /v2/events/{hash} — decoded events (Jetton transfers, etc.)
     │
     ▼
ton-normalizer — recursive trace → NormalizedCall tree
  (MESSAGE calls, BOUNCE for bounced messages, contract names from registry)
     │
     ▼
ton-tokenflow — extract from events:
  • Jetton transfers (mint/burn/transfer with amounts + symbols)
  • Native TON value transfers
     │
     ▼
ton-agent — LLM with TON-specific system prompt
  Tools: get_call_tree, get_token_flows, get_risk_flags
  Up to 12 autonomous tool-calling turns
     │
     ▼
Structured AnalysisResult streamed via SSE to Mini App
```

## Stack

| Layer | Tech |
|---|---|
| Mini App | Vite + React + Tailwind v4 (Telegram Mini App) |
| Backend | Node.js + TypeScript + Express |
| AI | Claude Haiku 4.5 via OpenRouter (agentic tool-calling loop) |
| TON Data | TonAPI (tonapi.io) |
| EVM Simulation | Tenderly REST API |
| Solana RPC | Helius / public endpoints |
| Auth | Telegram `initData` HMAC-SHA256 validation |
| Monorepo | npm workspaces (shared, backend, mini-app, mcp) |

## Setup

```bash
git clone <repo>
cd Debugger
npm install
cp .env.example packages/backend/.env
# Fill in your API keys (see .env.example for all options)
```

Key env vars:

```env
OPEN_ROUTER_API_KEY=sk-or-...       # LLM provider
TONAPI_KEY=...                       # TonAPI (optional, improves rate limits)
BOT_TOKEN=...                        # Telegram bot token from @BotFather
TENDERLY_ACCESS_KEY=...              # EVM simulation (for multi-chain support)
```

## Development

```bash
npm run dev:backend    # Express API on :3001
npm run dev:mini-app   # Telegram Mini App on :5174 (proxies /api to backend)
```

## Project Structure

```
packages/
  shared/       # TypeScript types (analysis, api, ton, solana, tenderly, rango)
  backend/
    src/
      services/
        ton-rpc.service.ts          # TonAPI fetch (traces + events)
        ton-normalizer.service.ts   # Trace → NormalizedCall tree
        ton-tokenflow.service.ts    # Events → Jetton/TON transfers
        ton-agent.service.ts        # TON-specific AI agent loop
        agent.service.ts            # EVM AI agent loop
        solana-agent.service.ts     # Solana AI agent loop
        ...
      registry/
        ton-contracts.ts            # Known TON contracts, Jettons, op-codes
        selectors.ts                # Known EVM function selectors
        solana-programs.ts          # Known Solana program IDs
      middleware/
        telegram-auth.middleware.ts  # HMAC-SHA256 initData validation
      routes/
        debug.route.ts              # /api/debug + /api/debug/stream (SSE)
        qa.route.ts                 # /api/qa (follow-up questions)
  mini-app/
    src/app/
      screens/    # ChatScreen, HistoryScreen, RiskDetailScreen
      api.ts      # Backend client with Telegram auth headers
      store.ts    # App state (history, current analysis)
      App.tsx     # Auth gate + router
  mcp/            # MCP server for Claude Code integration
```

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/debug/stream?txHash=...` | GET | SSE stream — real-time analysis with tool-call events |
| `/api/debug` | POST | One-shot analysis (returns full `AnalysisResult`) |
| `/api/qa` | POST | Follow-up questions about a transaction |
| `/api/auth/check` | GET | Verify Telegram `initData` session |
| `/api/usage` | GET | Per-user usage stats (requires Telegram auth) |

Network is auto-detected from the hash format. No chain selector needed.

## MCP Server

Explorai also works as an MCP tool inside [Claude Code](https://claude.com/claude-code):

```bash
claude mcp add debugger -- npx tsx packages/mcp/src/index.ts
```

Tools: `debug_transaction`, `get_call_tree`, `get_token_flows`, `get_risk_flags`, `resolve_rango_swap`
