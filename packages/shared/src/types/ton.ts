// ─── TON blockchain types ────────────────────────────────────────────────────

/** A single message in a TON transaction trace */
export interface TonMessage {
  hash: string;
  source: string;
  destination: string;
  value: string;            // nanoTON
  fwdFee: string;
  ihrFee: string;
  bounce: boolean;
  bounced: boolean;
  body?: string;            // BOC-encoded message body (base64)
  opCode?: number | null;   // 32-bit operation code from message body
  decodedOpName?: string;   // Human-readable op name if known
  createdLt: string;
  createdAt: number;
}

/** A single Jetton transfer event parsed from the trace */
export interface TonJettonTransfer {
  jettonMasterAddress: string;
  senderAddress: string;
  recipientAddress: string;
  amount: string;           // raw amount (smallest unit)
  symbol?: string;
  decimals?: number;
  comment?: string;         // forward payload text
}

/** NFT transfer event */
export interface TonNftTransfer {
  nftAddress: string;
  collectionAddress?: string;
  senderAddress: string;
  recipientAddress: string;
}

/** Account state change (for state diff display) */
export interface TonAccountStateChange {
  address: string;
  balanceBefore: string;    // nanoTON
  balanceAfter: string;     // nanoTON
  statusBefore: string;     // 'active' | 'uninit' | 'frozen'
  statusAfter: string;
}

/** Raw transaction from TON RPC / indexer */
export interface TonRawTransaction {
  hash: string;
  lt: string;
  utime: number;
  account: string;          // workchain:hex address
  fee: string;              // total fees in nanoTON
  storageFee: string;
  otherFee: string;
  success: boolean;
  exitCode: number;
  resultCode: number;
  origStatus: string;
  endStatus: string;
  totalFees: string;
  description: Record<string, unknown>;
  inMsg: TonMessage | null;
  outMsgs: TonMessage[];
}

/** Trace of all messages spawned by a transaction (from TonAPI /traces) */
export interface TonTrace {
  transaction: TonRawTransaction;
  children: TonTrace[];
}

/** Jetton metadata from indexer */
export interface TonJettonMeta {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
}

/** Structured event action from TonAPI (richer than just type+status) */
export interface TonEventAction {
  type: string;
  status: string;           // 'ok' | 'failed'
  description?: string;     // simple_preview description

  // ─── JettonSwap (DEX trades) ─────────────────────────────────────────────
  swap?: {
    dex: string;            // 'stonfi' | 'dedust' | etc.
    router: string;         // router contract address
    amountIn: string;       // raw input amount
    amountOut: string;      // raw output amount
    tokenIn: string;        // input jetton master address (or 'TON')
    tokenOut: string;       // output jetton master address (or 'TON')
    symbolIn?: string;
    symbolOut?: string;
    decimalsIn?: number;
    decimalsOut?: number;
    tonIn?: string;         // TON value attached (nanoTON)
    tonOut?: string;        // TON received back (nanoTON)
  };

  // ─── JettonBurn / JettonMint ─────────────────────────────────────────────
  burn?: {
    sender: string;
    amount: string;
    tokenAddress: string;
    symbol?: string;
    decimals?: number;
  };
  mint?: {
    recipient: string;
    amount: string;
    tokenAddress: string;
    symbol?: string;
    decimals?: number;
  };

  // ─── SmartContractExec ───────────────────────────────────────────────────
  contractExec?: {
    executor: string;
    contract: string;
    operation: string;
    tonAttached: string;    // nanoTON
  };

  // ─── ContractDeploy ─────────────────────────────────────────────────────
  deploy?: {
    address: string;
    interfaces: string[];   // e.g. ['wallet_v4r2', 'jetton_master']
  };

  // ─── Staking ────────────────────────────────────────────────────────────
  stake?: {
    pool: string;
    amount: string;         // nanoTON
    staker: string;
  };

  // ─── NftPurchase ────────────────────────────────────────────────────────
  nftPurchase?: {
    buyer: string;
    seller: string;
    nftAddress: string;
    price: string;          // nanoTON
    auctionType?: string;
  };
}

/** Unified TON tx data passed through the pipeline */
export interface TonTxData {
  trace: TonTrace;
  jettonTransfers: TonJettonTransfer[];
  nftTransfers: TonNftTransfer[];
  accountStateChanges: TonAccountStateChange[];
  jettonMeta: Map<string, TonJettonMeta>;
  /** address → human-readable name collected from TonAPI responses */
  accountNames: Map<string, string>;
  /** Addresses flagged as scam by TonAPI */
  scamAddresses: Set<string>;
  /** Structured event actions from TonAPI (includes failures not in trace tree) */
  eventActions?: TonEventAction[];
  txHash: string;
  networkId: string;
  success: boolean;
  lt: string;
  utime: number;
  fee: string;
  account: string;
  exitCode: number;
}
