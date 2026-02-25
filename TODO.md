# Feature Backlog

## Agent Tools
- [ ] **`decode_calldata(data, address?)`** — look up unknown function selectors via 4byte.directory
- [ ] **`get_token_price(tokenAddress, networkId, timestamp)`** — historical price via DeFiLlama/CoinGecko; gives exact dollar values at tx time
- [ ] **`get_block_context(blockNumber, networkId)`** — block timestamp, base fee, gas limit; useful for deadline failures and EIP-1559 analysis
- [ ] **`search_similar_failures(revertReason)`** — match against a local database of known failure patterns

## Analysis
- [ ] **MEV detection** — check block position for sandwich patterns (buy before + sell after by same address)
- [ ] **Slippage calculator** — for failed swaps, compute what minAmountOut would have worked
- [ ] **Nonce & gas analysis** — flag nonce gaps (stuck txs), explain EIP-1559 base fee vs priority fee

## Frontend
- [ ] **Token flow Sankey diagram** — visual money-flow chart instead of plain table
- [ ] **Transaction diff / compare** — side-by-side view of two transactions (e.g. failed vs retried)
- [ ] **Persistent history** — save past analyses to localStorage so they survive page refresh

## Infrastructure
- [ ] **SQLite/LevelDB cache** — replace the in-memory Map so analyses survive server restarts
- [ ] **`/api/simulate` dry-run endpoint** — simulate a not-yet-broadcast transaction for pre-flight checking
- [ ] **Multi-chain RPC fallback** — try secondary RPC if primary fails; add Berachain public RPC

## Completed
- [x] **SSE progress streaming** — live tool-by-tool activity log shown in the UI during analysis
- [x] **`get_revert_source_location` tool** — fetches verified Solidity source from Etherscan V2; searches all compilation files by function name; returns only files containing the matching definition
- [x] **Berachain support (chain 80094)** — routes Etherscan queries through V2 API (`api.etherscan.io/v2/api?chainid=80094`)
- [x] **Full address in call tree** — always shows 42-char addresses so the LLM can use them directly as tool arguments
- [x] **`simulate_with_fix` tool** — re-simulates with gas increase, ETH balance override, or ERC20 allowance override via Tenderly state overrides
- [x] **`cast_call` / `cast_run` tools** — on-chain state queries and opcode-level trace via Foundry
