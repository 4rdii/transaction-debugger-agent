// 4-byte function selector → protocol + action mapping
// Selector = first 4 bytes of keccak256(functionSignature)

export interface SelectorInfo {
  protocol: string;
  action: string;
  functionSignature: string;
}

export const SELECTOR_REGISTRY: Record<string, SelectorInfo> = {
  // ─── ERC20 ───────────────────────────────────────────────────────────────
  '0xa9059cbb': { protocol: 'ERC20', action: 'Transfer', functionSignature: 'transfer(address,uint256)' },
  '0x23b872dd': { protocol: 'ERC20', action: 'TransferFrom', functionSignature: 'transferFrom(address,address,uint256)' },
  '0x095ea7b3': { protocol: 'ERC20', action: 'Approve', functionSignature: 'approve(address,uint256)' },
  '0x70a08231': { protocol: 'ERC20', action: 'BalanceOf', functionSignature: 'balanceOf(address)' },

  // ─── Uniswap V2 ──────────────────────────────────────────────────────────
  '0x38ed1739': { protocol: 'Uniswap V2', action: 'Swap', functionSignature: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)' },
  '0x8803dbee': { protocol: 'Uniswap V2', action: 'Swap', functionSignature: 'swapTokensForExactTokens(uint256,uint256,address[],address,uint256)' },
  '0x7ff36ab5': { protocol: 'Uniswap V2', action: 'Swap', functionSignature: 'swapExactETHForTokens(uint256,address[],address,uint256)' },
  '0x18cbafe5': { protocol: 'Uniswap V2', action: 'Swap', functionSignature: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)' },
  '0xfb3bdb41': { protocol: 'Uniswap V2', action: 'Swap', functionSignature: 'swapETHForExactTokens(uint256,address[],address,uint256)' },
  '0x4a25d94a': { protocol: 'Uniswap V2', action: 'Swap', functionSignature: 'swapTokensForExactETH(uint256,uint256,address[],address,uint256)' },
  '0xe8e33700': { protocol: 'Uniswap V2', action: 'AddLiquidity', functionSignature: 'addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)' },
  '0xbaa2abde': { protocol: 'Uniswap V2', action: 'RemoveLiquidity', functionSignature: 'removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)' },

  // ─── Uniswap V3 ──────────────────────────────────────────────────────────
  '0x414bf389': { protocol: 'Uniswap V3', action: 'Swap', functionSignature: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))' },
  '0xdb3e2198': { protocol: 'Uniswap V3', action: 'Swap', functionSignature: 'exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))' },
  '0xc04b8d59': { protocol: 'Uniswap V3', action: 'Swap', functionSignature: 'exactInput((bytes,address,uint256,uint256,uint256))' },
  '0xf28c0498': { protocol: 'Uniswap V3', action: 'Swap', functionSignature: 'exactOutput((bytes,address,uint256,uint256,uint256))' },
  '0xac9650d8': { protocol: 'Uniswap V3', action: 'Multicall', functionSignature: 'multicall(bytes[])' },
  '0x5ae401dc': { protocol: 'Uniswap V3', action: 'Multicall', functionSignature: 'multicall(uint256,bytes[])' },

  // ─── Uniswap Universal Router ─────────────────────────────────────────────
  '0x3593564c': { protocol: 'Uniswap Universal Router', action: 'Execute', functionSignature: 'execute(bytes,bytes[],uint256)' },

  // ─── Curve ───────────────────────────────────────────────────────────────
  '0x3df02124': { protocol: 'Curve', action: 'Swap', functionSignature: 'exchange(int128,int128,uint256,uint256)' },
  '0xa6417ed6': { protocol: 'Curve', action: 'Swap', functionSignature: 'exchange_underlying(int128,int128,uint256,uint256)' },
  '0x0b4c7e4d': { protocol: 'Curve', action: 'AddLiquidity', functionSignature: 'add_liquidity(uint256[2],uint256)' },
  '0x4515cef3': { protocol: 'Curve', action: 'AddLiquidity', functionSignature: 'add_liquidity(uint256[3],uint256)' },
  '0x5b41b908': { protocol: 'Curve', action: 'RemoveLiquidity', functionSignature: 'remove_liquidity_one_coin(uint256,int128,uint256)' },

  // ─── Aave V2 ─────────────────────────────────────────────────────────────
  '0xab9c4b5d': { protocol: 'Aave V2', action: 'Flashloan', functionSignature: 'flashLoan(address,address[],uint256[],uint256[],address,bytes,uint16)' },
  '0xe8eda9df': { protocol: 'Aave V2', action: 'Deposit', functionSignature: 'deposit(address,uint256,address,uint16)' },
  '0x69328dec': { protocol: 'Aave V2', action: 'Withdraw', functionSignature: 'withdraw(address,uint256,address)' },
  '0xa415bcad': { protocol: 'Aave V2', action: 'Borrow', functionSignature: 'borrow(address,uint256,uint256,uint16,address)' },
  '0x573ade81': { protocol: 'Aave V2', action: 'Repay', functionSignature: 'repay(address,uint256,uint256,address)' },
  '0xdfd5281b': { protocol: 'Aave V2', action: 'Liquidation', functionSignature: 'liquidationCall(address,address,address,uint256,bool)' },

  // ─── Aave V3 ─────────────────────────────────────────────────────────────
  '0x617ba037': { protocol: 'Aave V3', action: 'Supply', functionSignature: 'supply(address,uint256,address,uint16)' },
  '0x2dad97d4': { protocol: 'Aave V3', action: 'Flashloan', functionSignature: 'flashLoanSimple(address,address,uint256,bytes,uint16)' },

  // ─── Compound V2 ─────────────────────────────────────────────────────────
  '0xa0712d68': { protocol: 'Compound V2', action: 'Mint', functionSignature: 'mint(uint256)' },
  '0xdb006a75': { protocol: 'Compound V2', action: 'Redeem', functionSignature: 'redeem(uint256)' },
  '0x852a12e3': { protocol: 'Compound V2', action: 'RedeemUnderlying', functionSignature: 'redeemUnderlying(uint256)' },
  '0xf5e3c462': { protocol: 'Compound V2', action: 'Liquidate', functionSignature: 'liquidateBorrow(address,uint256,address)' },

  // ─── Balancer ────────────────────────────────────────────────────────────
  '0x52bbbe29': { protocol: 'Balancer', action: 'Swap', functionSignature: 'swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)' },
  '0x945bcec9': { protocol: 'Balancer', action: 'BatchSwap', functionSignature: 'batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)' },
  '0xb95cac28': { protocol: 'Balancer', action: 'Flashloan', functionSignature: 'flashLoan(address,address[],uint256[],bytes)' },

  // ─── 1inch ────────────────────────────────────────────────────────────────
  '0x7c025200': { protocol: '1inch', action: 'Swap', functionSignature: 'swap(address,(address,address,address,address,uint256,uint256,uint256,bytes),bytes)' },
  '0xe449022e': { protocol: '1inch', action: 'Swap', functionSignature: 'uniswapV3Swap(uint256,uint256,uint256[])' },
  '0x12aa3caf': { protocol: '1inch', action: 'Swap', functionSignature: 'swapExactInputSingle(uint256,(uint256,uint256,uint256,bytes32,address,address,address,bytes))' },

  // ─── WETH ─────────────────────────────────────────────────────────────────
  '0xd0e30db0': { protocol: 'WETH', action: 'Deposit', functionSignature: 'deposit()' },
  '0x2e1a7d4d': { protocol: 'WETH', action: 'Withdraw', functionSignature: 'withdraw(uint256)' },

  // ─── Multicall ───────────────────────────────────────────────────────────
  '0x252dba42': { protocol: 'Multicall', action: 'Multicall', functionSignature: 'aggregate((address,bytes)[])' },
  '0x82ad56cb': { protocol: 'Multicall', action: 'Multicall', functionSignature: 'tryAggregate(bool,(address,bytes)[])' },
};

export const SWAP_SELECTORS = new Set(
  Object.entries(SELECTOR_REGISTRY)
    .filter(([, info]) => info.action === 'Swap')
    .map(([sel]) => sel)
);

export const FLASHLOAN_SELECTORS = new Set(
  Object.entries(SELECTOR_REGISTRY)
    .filter(([, info]) => info.action === 'Flashloan')
    .map(([sel]) => sel)
);

export const APPROVE_SELECTORS = new Set(['0x095ea7b3']);

export const MULTICALL_SELECTORS = new Set(
  Object.entries(SELECTOR_REGISTRY)
    .filter(([, info]) => info.action === 'Multicall')
    .map(([sel]) => sel)
);

// Known bridge contract addresses (lowercase)
export const BRIDGE_ADDRESSES = new Set([
  '0x3154cf16ccdb4c6d922629664174b904d80f2c35', // Base bridge
  '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', // Optimism bridge
  '0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f', // Arbitrum bridge
  '0xa0c68c638235ee32657e8f720a23cec1bfc77c77', // Polygon bridge
  '0xd3a691c852cdb01e281545a27064741f0b7f6825', // Stargate router
]);

export function lookupSelector(selector: string): SelectorInfo | undefined {
  return SELECTOR_REGISTRY[selector.toLowerCase()];
}
