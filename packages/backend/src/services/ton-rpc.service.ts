import { getTonApiBaseUrl, getTonApiHeaders } from '../config.js';
import type {
  TonTrace,
  TonRawTransaction,
  TonMessage,
  TonJettonTransfer,
  TonNftTransfer,
  TonAccountStateChange,
  TonJettonMeta,
  TonTxData,
  TonEventAction,
} from '@debugger/shared';

const TIMEOUT_MS = 20_000;

// ─── TonAPI response types ──────────────────────────────────────────────────

interface TonApiAccount {
  address: string;
  is_scam: boolean;
  is_wallet: boolean;
  name?: string;
}

interface TonApiMessage {
  hash: string;
  source?: TonApiAccount;
  destination?: TonApiAccount;
  value: number;
  fwd_fee: number;
  ihr_fee: number;
  bounce: boolean;
  bounced: boolean;
  body?: string;
  op_code?: string;      // hex string like "0x0f8a7ea5"
  created_lt: string;
  created_at: number;
  decoded_op_name?: string;
  decoded_body?: Record<string, unknown>;
}

interface TonApiTransaction {
  hash: string;
  lt: string;
  utime: number;
  account: TonApiAccount;
  fee: number;
  storage_fee: number;
  other_fee: number;
  success: boolean;
  exit_code?: number;
  result_code?: number;
  orig_status: string;
  end_status: string;
  total_fees: number;
  description: Record<string, unknown>;
  in_msg?: TonApiMessage;
  out_msgs: TonApiMessage[];
}

interface TonApiTrace {
  transaction: TonApiTransaction;
  children?: TonApiTrace[];
}

interface TonApiJettonPreview {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
  verification?: string;  // 'whitelist' | 'blacklist' | 'none'
}

interface TonApiEvent {
  actions: TonApiAction[];
  is_scam?: boolean;
  value_flow?: TonApiValueFlow[];
}

interface TonApiValueFlow {
  account: TonApiAccount;
  ton: number;
  fees: number;
  jettons?: { account: TonApiAccount; jetton: TonApiJettonPreview; quantity: number }[];
}

interface TonApiAction {
  type: string;
  status: string;
  simple_preview?: { name?: string; description?: string };

  JettonTransfer?: {
    sender: TonApiAccount;
    recipient: TonApiAccount;
    senders_wallet: string;
    recipients_wallet: string;
    amount: string;
    comment?: string;
    jetton: TonApiJettonPreview;
  };
  JettonSwap?: {
    dex: string;
    router: TonApiAccount;
    amount_in: string;
    amount_out: string;
    jetton_master_in?: TonApiJettonPreview;
    jetton_master_out?: TonApiJettonPreview;
    ton_in?: number;
    ton_out?: number;
  };
  JettonBurn?: {
    sender: TonApiAccount;
    senders_wallet: string;
    amount: string;
    jetton: TonApiJettonPreview;
  };
  JettonMint?: {
    recipient: TonApiAccount;
    recipients_wallet: string;
    amount: string;
    jetton: TonApiJettonPreview;
  };
  SmartContractExec?: {
    executor: TonApiAccount;
    contract: TonApiAccount;
    operation: string;
    ton_attached: number;
    payload?: string;
  };
  ContractDeploy?: {
    address: string;
    interfaces: string[];
  };
  DepositStake?: {
    pool: TonApiAccount;
    amount: number;
    staker: TonApiAccount;
  };
  WithdrawStake?: {
    pool: TonApiAccount;
    amount: number;
    staker: TonApiAccount;
  };
  WithdrawStakeRequest?: {
    pool: TonApiAccount;
    amount: number;
    staker: TonApiAccount;
  };
  NftPurchase?: {
    buyer: TonApiAccount;
    seller: TonApiAccount;
    nft: { address: string };
    amount: { value: string; token_name: string };
    auction_type?: string;
  };
  FlawedJettonTransfer?: {
    sender: TonApiAccount;
    recipient: TonApiAccount;
    amount: string;
    jetton: TonApiJettonPreview;
  };
  NftItemTransfer?: {
    sender: TonApiAccount;
    recipient: TonApiAccount;
    nft: string;
  };
  TonTransfer?: {
    sender: TonApiAccount;
    recipient: TonApiAccount;
    amount: number;
    comment?: string;
  };
}

// ─── Converters ─────────────────────────────────────────────────────────────

function convertMessage(msg: TonApiMessage | undefined): TonMessage | null {
  if (!msg) return null;
  return {
    hash: msg.hash,
    source: msg.source?.address ?? '',
    destination: msg.destination?.address ?? '',
    value: String(msg.value),
    fwdFee: String(msg.fwd_fee),
    ihrFee: String(msg.ihr_fee),
    bounce: msg.bounce,
    bounced: msg.bounced,
    body: msg.body,
    opCode: msg.op_code ? parseInt(msg.op_code, 16) : null,
    decodedOpName: msg.decoded_op_name,
    createdLt: msg.created_lt,
    createdAt: msg.created_at,
  };
}

function convertTransaction(tx: TonApiTransaction): TonRawTransaction {
  return {
    hash: tx.hash,
    lt: tx.lt,
    utime: tx.utime,
    account: tx.account.address,
    fee: String(tx.fee),
    storageFee: String(tx.storage_fee),
    otherFee: String(tx.other_fee),
    success: tx.success,
    exitCode: tx.exit_code ?? 0,
    resultCode: tx.result_code ?? 0,
    origStatus: tx.orig_status,
    endStatus: tx.end_status,
    totalFees: String(tx.total_fees),
    description: tx.description,
    inMsg: convertMessage(tx.in_msg),
    outMsgs: tx.out_msgs.map(m => convertMessage(m)!),
  };
}

function convertTrace(apiTrace: TonApiTrace): TonTrace {
  return {
    transaction: convertTransaction(apiTrace.transaction),
    children: (apiTrace.children ?? []).map(convertTrace),
  };
}

// ─── Scam detection ─────────────────────────────────────────────────────────

function collectScamAddresses(apiTrace: TonApiTrace, event: TonApiEvent | null): Set<string> {
  const scam = new Set<string>();

  function walkAccount(acct: TonApiAccount | undefined) {
    if (acct?.is_scam) scam.add(acct.address);
  }

  function walkTrace(node: TonApiTrace) {
    walkAccount(node.transaction.account);
    walkAccount(node.transaction.in_msg?.source);
    walkAccount(node.transaction.in_msg?.destination);
    for (const msg of node.transaction.out_msgs) {
      walkAccount(msg.source);
      walkAccount(msg.destination);
    }
    for (const child of node.children ?? []) walkTrace(child);
  }

  walkTrace(apiTrace);

  // Also check event-level accounts
  if (event) {
    for (const action of event.actions) {
      const accounts: (TonApiAccount | undefined)[] = [];
      if (action.JettonTransfer) accounts.push(action.JettonTransfer.sender, action.JettonTransfer.recipient);
      if (action.JettonSwap) accounts.push(action.JettonSwap.router);
      if (action.TonTransfer) accounts.push(action.TonTransfer.sender, action.TonTransfer.recipient);
      if (action.SmartContractExec) accounts.push(action.SmartContractExec.executor, action.SmartContractExec.contract);
      if (action.NftPurchase) accounts.push(action.NftPurchase.buyer, action.NftPurchase.seller);
      if (action.DepositStake) accounts.push(action.DepositStake.pool, action.DepositStake.staker);
      if (action.WithdrawStake) accounts.push(action.WithdrawStake.pool, action.WithdrawStake.staker);
      for (const a of accounts) walkAccount(a);
    }
  }

  return scam;
}

// ─── Event action extraction ─────────────────────────────────────────────────

function convertEventAction(action: TonApiAction): TonEventAction {
  const base: TonEventAction = {
    type: action.type,
    status: action.status,
    description: action.simple_preview?.description,
  };

  if (action.JettonSwap) {
    const s = action.JettonSwap;
    base.swap = {
      dex: s.dex,
      router: s.router.address,
      amountIn: s.amount_in,
      amountOut: s.amount_out,
      tokenIn: s.jetton_master_in?.address ?? 'TON',
      tokenOut: s.jetton_master_out?.address ?? 'TON',
      symbolIn: s.jetton_master_in?.symbol ?? 'TON',
      symbolOut: s.jetton_master_out?.symbol ?? 'TON',
      decimalsIn: s.jetton_master_in?.decimals ?? 9,
      decimalsOut: s.jetton_master_out?.decimals ?? 9,
      tonIn: s.ton_in != null ? String(s.ton_in) : undefined,
      tonOut: s.ton_out != null ? String(s.ton_out) : undefined,
    };
  }

  if (action.JettonBurn) {
    const b = action.JettonBurn;
    base.burn = {
      sender: b.sender.address,
      amount: b.amount,
      tokenAddress: b.jetton.address,
      symbol: b.jetton.symbol,
      decimals: b.jetton.decimals,
    };
  }

  if (action.JettonMint) {
    const m = action.JettonMint;
    base.mint = {
      recipient: m.recipient.address,
      amount: m.amount,
      tokenAddress: m.jetton.address,
      symbol: m.jetton.symbol,
      decimals: m.jetton.decimals,
    };
  }

  if (action.SmartContractExec) {
    const e = action.SmartContractExec;
    base.contractExec = {
      executor: e.executor.address,
      contract: e.contract.address,
      operation: e.operation,
      tonAttached: String(e.ton_attached),
    };
  }

  if (action.ContractDeploy) {
    base.deploy = {
      address: action.ContractDeploy.address,
      interfaces: action.ContractDeploy.interfaces ?? [],
    };
  }

  if (action.DepositStake) {
    const d = action.DepositStake;
    base.stake = { pool: d.pool.address, amount: String(d.amount), staker: d.staker.address };
  }
  if (action.WithdrawStake) {
    const w = action.WithdrawStake;
    base.stake = { pool: w.pool.address, amount: String(w.amount), staker: w.staker.address };
  }
  if (action.WithdrawStakeRequest) {
    const w = action.WithdrawStakeRequest;
    base.stake = { pool: w.pool.address, amount: String(w.amount), staker: w.staker.address };
  }

  if (action.NftPurchase) {
    const n = action.NftPurchase;
    base.nftPurchase = {
      buyer: n.buyer.address,
      seller: n.seller.address,
      nftAddress: n.nft.address,
      price: n.amount.value,
      auctionType: n.auction_type,
    };
  }

  return base;
}

// ─── API calls ──────────────────────────────────────────────────────────────

async function fetchTonApiJson<T>(path: string, networkId: string): Promise<T> {
  const baseUrl = getTonApiBaseUrl(networkId);
  const headers = getTonApiHeaders();

  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TonAPI error: HTTP ${res.status} for ${path} — ${body}`);
  }

  return (await res.json()) as T;
}

async function fetchEvent(txHash: string, networkId: string): Promise<TonApiEvent | null> {
  try {
    return await fetchTonApiJson<TonApiEvent>(
      `/v2/events/${txHash}`,
      networkId,
    );
  } catch {
    // Event endpoint may not be available for all txs
    return null;
  }
}

function extractTransfersFromEvent(event: TonApiEvent | null): {
  jettonTransfers: TonJettonTransfer[];
  nftTransfers: TonNftTransfer[];
  jettonMeta: Map<string, TonJettonMeta>;
} {
  const jettonTransfers: TonJettonTransfer[] = [];
  const nftTransfers: TonNftTransfer[] = [];
  const jettonMeta = new Map<string, TonJettonMeta>();

  if (!event) return { jettonTransfers, nftTransfers, jettonMeta };

  for (const action of event.actions) {
    if (action.type === 'JettonTransfer' && action.JettonTransfer) {
      const jt = action.JettonTransfer;
      jettonTransfers.push({
        jettonMasterAddress: jt.jetton.address,
        senderAddress: jt.sender?.address ?? '',
        recipientAddress: jt.recipient?.address ?? '',
        amount: jt.amount,
        symbol: jt.jetton.symbol,
        decimals: jt.jetton.decimals,
        comment: jt.comment,
      });
      jettonMeta.set(jt.jetton.address, {
        address: jt.jetton.address,
        name: jt.jetton.name,
        symbol: jt.jetton.symbol,
        decimals: jt.jetton.decimals,
        image: jt.jetton.image,
      });
    }

    // JettonSwap — also register jetton metadata from swap tokens
    if (action.type === 'JettonSwap' && action.JettonSwap) {
      const s = action.JettonSwap;
      for (const j of [s.jetton_master_in, s.jetton_master_out]) {
        if (j) {
          jettonMeta.set(j.address, {
            address: j.address,
            name: j.name,
            symbol: j.symbol,
            decimals: j.decimals,
            image: j.image,
          });
        }
      }
    }

    // JettonBurn / JettonMint — register metadata
    if (action.type === 'JettonBurn' && action.JettonBurn) {
      const j = action.JettonBurn.jetton;
      jettonMeta.set(j.address, { address: j.address, name: j.name, symbol: j.symbol, decimals: j.decimals, image: j.image });
    }
    if (action.type === 'JettonMint' && action.JettonMint) {
      const j = action.JettonMint.jetton;
      jettonMeta.set(j.address, { address: j.address, name: j.name, symbol: j.symbol, decimals: j.decimals, image: j.image });
    }

    if (action.type === 'NftItemTransfer' && action.NftItemTransfer) {
      const nt = action.NftItemTransfer;
      nftTransfers.push({
        nftAddress: nt.nft,
        senderAddress: nt.sender?.address ?? '',
        recipientAddress: nt.recipient?.address ?? '',
      });
    }
  }

  return { jettonTransfers, nftTransfers, jettonMeta };
}

/** Collect address → name mapping from TonAPI account objects in the trace */
function collectAccountNames(apiTrace: TonApiTrace, event: TonApiEvent | null): Map<string, string> {
  const names = new Map<string, string>();

  function addAccount(acct: TonApiAccount | undefined) {
    if (acct?.name) names.set(acct.address, acct.name);
  }

  function walkTrace(node: TonApiTrace) {
    const tx = node.transaction;
    addAccount(tx.account);
    addAccount(tx.in_msg?.source);
    addAccount(tx.in_msg?.destination);
    for (const msg of tx.out_msgs) {
      addAccount(msg.source);
      addAccount(msg.destination);
    }
    for (const child of node.children ?? []) walkTrace(child);
  }

  walkTrace(apiTrace);

  // Also collect names from all event action accounts
  if (event) {
    for (const action of event.actions) {
      if (action.JettonTransfer) { addAccount(action.JettonTransfer.sender); addAccount(action.JettonTransfer.recipient); }
      if (action.JettonSwap) { addAccount(action.JettonSwap.router); }
      if (action.TonTransfer) { addAccount(action.TonTransfer.sender); addAccount(action.TonTransfer.recipient); }
      if (action.SmartContractExec) { addAccount(action.SmartContractExec.executor); addAccount(action.SmartContractExec.contract); }
      if (action.NftPurchase) { addAccount(action.NftPurchase.buyer); addAccount(action.NftPurchase.seller); }
      if (action.DepositStake) { addAccount(action.DepositStake.pool); addAccount(action.DepositStake.staker); }
      if (action.WithdrawStake) { addAccount(action.WithdrawStake.pool); addAccount(action.WithdrawStake.staker); }
      if (action.WithdrawStakeRequest) { addAccount(action.WithdrawStakeRequest.pool); addAccount(action.WithdrawStakeRequest.staker); }
      if (action.NftItemTransfer) { addAccount(action.NftItemTransfer.sender); addAccount(action.NftItemTransfer.recipient); }
    }
  }

  return names;
}

function extractAccountStateChanges(trace: TonTrace): TonAccountStateChange[] {
  const changes: TonAccountStateChange[] = [];
  const visited = new Set<string>();

  function walk(node: TonTrace) {
    const tx = node.transaction;
    if (!visited.has(tx.account)) {
      visited.add(tx.account);
      changes.push({
        address: tx.account,
        balanceBefore: '0', // TonAPI doesn't give pre-balance; set placeholders
        balanceAfter: '0',
        statusBefore: tx.origStatus,
        statusAfter: tx.endStatus,
      });
    }
    for (const child of node.children) walk(child);
  }

  walk(trace);
  return changes;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function fetchTonTransaction(
  txHash: string,
  networkId: string,
): Promise<TonTxData> {
  // Fetch raw API trace (before conversion) to collect account names + scam flags
  const [apiTrace, event] = await Promise.all([
    fetchTonApiJson<TonApiTrace>(`/v2/traces/${txHash}`, networkId),
    fetchEvent(txHash, networkId),
  ]);

  // Collect human-readable account names from both trace and event
  const accountNames = collectAccountNames(apiTrace, event);

  // Collect scam-flagged addresses from trace and event accounts
  const scamAddresses = collectScamAddresses(apiTrace, event);

  const trace = convertTrace(apiTrace);
  const { jettonTransfers, nftTransfers, jettonMeta } = extractTransfersFromEvent(event);
  const accountStateChanges = extractAccountStateChanges(trace);

  // Extract structured event actions
  const eventActions: TonEventAction[] = (event?.actions ?? []).map(convertEventAction);

  const rootTx = trace.transaction;

  return {
    trace,
    jettonTransfers,
    nftTransfers,
    accountStateChanges,
    jettonMeta,
    accountNames,
    scamAddresses,
    eventActions,
    txHash,
    networkId,
    success: rootTx.success,
    lt: rootTx.lt,
    utime: rootTx.utime,
    fee: rootTx.fee,
    account: rootTx.account,
    exitCode: rootTx.exitCode,
  };
}
