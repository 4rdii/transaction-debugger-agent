import { getSolanaRpcUrl, getHeliusUrl } from '../config.js';
import type {
  SolanaRawTransaction,
  HeliusEnrichedTransaction,
  SolanaTxData,
} from '@debugger/shared';

const TIMEOUT_MS = 15_000;

async function fetchRpcTransaction(
  signature: string,
  rpcUrl: string,
): Promise<SolanaRawTransaction> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Solana RPC error: HTTP ${res.status}`);
  }

  const json = (await res.json()) as { result: SolanaRawTransaction | null; error?: { message: string } };

  if (json.error) {
    throw new Error(`Solana RPC error: ${json.error.message}`);
  }
  if (!json.result) {
    throw new Error(`Transaction not found: ${signature}`);
  }

  return json.result;
}

async function fetchHeliusEnriched(
  signature: string,
  networkId: string,
): Promise<HeliusEnrichedTransaction | null> {
  const url = getHeliusUrl(networkId);
  if (!url) return null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [signature] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as HeliusEnrichedTransaction[];
    return data[0] ?? null;
  } catch {
    // Helius is optional — graceful fallback
    return null;
  }
}

export async function fetchSolanaTransaction(
  signature: string,
  networkId: string,
): Promise<SolanaTxData> {
  const rpcUrl = getSolanaRpcUrl(networkId);

  const [raw, enriched] = await Promise.all([
    fetchRpcTransaction(signature, rpcUrl),
    fetchHeliusEnriched(signature, networkId),
  ]);

  const accountKeys = raw.transaction.message.accountKeys.map(k => k.pubkey);
  const feePayer = enriched?.feePayer ?? accountKeys[0] ?? '';

  return {
    raw,
    enriched,
    signature,
    networkId,
    success: raw.meta.err === null,
    slot: raw.slot,
    fee: raw.meta.fee,
    computeUnitsConsumed: raw.meta.computeUnitsConsumed ?? 0,
    feePayer,
    accountKeys,
    logMessages: raw.meta.logMessages ?? [],
  };
}
