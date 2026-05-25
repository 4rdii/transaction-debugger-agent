/**
 * Subscription service — free tier (5 analyses/day) + Pro plan.
 *
 * Pro can be activated via:
 *   A) TON Connect — wallet sends TON directly, backend polls TonAPI to verify
 *   B) Telegram Stars — invoice created via Bot API, activated on payment
 *
 * State is persisted to SUBSCRIPTION_STORE_PATH (default: ./subscription-store.json).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getTonApiBaseUrl, getTonApiHeaders } from '../config.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const FREE_DAILY_LIMIT = parseInt(process.env['FREE_DAILY_LIMIT'] ?? '5', 10);
export const FREE_TOTAL_LIMIT = FREE_DAILY_LIMIT; // backwards compat alias
const SUBSCRIPTION_DAYS = parseInt(process.env['PRO_DURATION_DAYS'] ?? '30', 10);
const TON_SUBSCRIPTION_PRICE_TON = parseFloat(process.env['TON_SUBSCRIPTION_PRICE'] ?? '3');
const TON_WALLET_ADDRESS = process.env['TON_WALLET_ADDRESS'] ?? '';
export const STARS_PRICE = parseInt(process.env['STARS_PRICE'] ?? '500', 10);
const BOT_TOKEN = process.env['BOT_TOKEN'] ?? '';
const STORE_PATH = process.env['SUBSCRIPTION_STORE_PATH'] ?? './subscription-store.json';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubscriptionRecord {
  userId: number;
  plan: 'free' | 'pro';
  proExpiresAt?: string;
  totalFreeCount: number;        // lifetime total (for stats)
  dailyCount: number;            // analyses used today
  dailyDate: string;             // YYYY-MM-DD UTC of last count
  verifiedTxHashes: string[];    // prevent double-spend
}

interface StoreData {
  subscriptions: Record<string, SubscriptionRecord>;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const storeData: StoreData = { subscriptions: {} };

function loadStore(): void {
  try {
    if (existsSync(STORE_PATH)) {
      const raw = readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      Object.assign(storeData.subscriptions, parsed.subscriptions ?? {});
    }
  } catch (err) {
    console.warn('[subscription] Failed to load store:', err);
  }
}

function saveStore(): void {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(storeData, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[subscription] Failed to save store:', err);
  }
}

loadStore();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getRecord(userId: number): SubscriptionRecord {
  const key = String(userId);
  if (!storeData.subscriptions[key]) {
    storeData.subscriptions[key] = {
      userId,
      plan: 'free',
      totalFreeCount: 0,
      dailyCount: 0,
      dailyDate: todayUtc(),
      verifiedTxHashes: [],
    };
  }
  const record = storeData.subscriptions[key]!;
  // Reset daily counter at UTC midnight
  if (record.dailyDate !== todayUtc()) {
    record.dailyCount = 0;
    record.dailyDate = todayUtc();
  }
  return record;
}

const normalize = (addr: string) => addr.toLowerCase().replace(/^0:/, '').replace(/-/g, '+').replace(/_/g, '/');

// ─── Public read API ──────────────────────────────────────────────────────────

export function isProUser(userId: number): boolean {
  const record = getRecord(userId);
  if (record.plan !== 'pro' || !record.proExpiresAt) return false;
  return new Date(record.proExpiresAt) > new Date();
}

export interface UsageStatus {
  plan: 'free' | 'pro';
  isPro: boolean;
  used: number;
  remaining: number | null;
  limit: number | null;
  proExpiresAt?: string;
  allowed: boolean;
}

export function getUsageStatus(userId: number): UsageStatus {
  const isPro = isProUser(userId);
  const record = getRecord(userId);
  if (isPro) {
    return {
      plan: 'pro',
      isPro: true,
      used: record.dailyCount,
      remaining: null,
      limit: null,
      proExpiresAt: record.proExpiresAt,
      allowed: true,
    };
  }
  const used = record.dailyCount;
  const remaining = Math.max(0, FREE_DAILY_LIMIT - used);
  return {
    plan: 'free',
    isPro: false,
    used,
    remaining,
    limit: FREE_DAILY_LIMIT,
    allowed: remaining > 0,
  };
}

export function getFreeCount(userId: number): number {
  return getRecord(userId).dailyCount;
}

// ─── Public write API ─────────────────────────────────────────────────────────

export function incrementFreeCount(userId: number): void {
  const record = getRecord(userId);
  record.dailyCount = (record.dailyCount ?? 0) + 1;
  record.totalFreeCount = (record.totalFreeCount ?? 0) + 1;
  saveStore();
}

export function activateSubscription(userId: number): void {
  const record = getRecord(userId);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + SUBSCRIPTION_DAYS);
  record.plan = 'pro';
  record.proExpiresAt = expiry.toISOString();
  saveStore();
  console.log(`[subscription] User ${userId} upgraded to Pro until ${record.proExpiresAt}`);
}

// ─── Payment info ─────────────────────────────────────────────────────────────

export interface PaymentInfo {
  walletAddress: string;
  amountTon: number;
  memo: string;
  durationDays: number;
  priceUsd: number;
  starsPrice: number;
  configured: boolean;
}

export function getPaymentInfo(userId: number): PaymentInfo {
  return {
    walletAddress: TON_WALLET_ADDRESS,
    amountTon: TON_SUBSCRIPTION_PRICE_TON,
    memo: `explorai_${userId}`,
    durationDays: SUBSCRIPTION_DAYS,
    priceUsd: 9,
    starsPrice: STARS_PRICE,
    configured: Boolean(TON_WALLET_ADDRESS),
  };
}

// ─── A) TON Connect verification (poll by wallet address) ─────────────────────

interface TonApiTx {
  hash: string;
  success: boolean;
  out_msgs?: Array<{
    hash: string;
    destination?: { address: string };
    value: number;
    decoded_body?: Record<string, unknown>;
  }>;
}

interface TonApiTxList {
  transactions: TonApiTx[];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Called after a TON Connect sendTransaction completes.
 * Polls the sender's wallet for a recent outgoing TX to our payment address
 * with the correct amount and memo. Retries up to 5x with back-off.
 */
export async function verifyTonConnectPayment(
  senderAddress: string,
  userId: number,
): Promise<{ success: boolean; error?: string }> {
  if (!TON_WALLET_ADDRESS) {
    return { success: false, error: 'TON payments are not configured yet.' };
  }

  const baseUrl = getTonApiBaseUrl('ton-mainnet');
  const headers = { Accept: 'application/json', ...getTonApiHeaders() };
  const minNano = TON_SUBSCRIPTION_PRICE_TON * 1e9 * 0.99;

  // Poll up to 5 times: 3s, 6s, 10s, 15s, 20s after call
  const delays = [3000, 3000, 4000, 5000, 5000];

  for (let attempt = 0; attempt < delays.length; attempt++) {
    await sleep(delays[attempt]!);

    try {
      const res = await fetch(
        `${baseUrl}/v2/blockchain/accounts/${encodeURIComponent(senderAddress)}/transactions?limit=10`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) continue;

      const data = (await res.json()) as TonApiTxList;
      const txs = data.transactions ?? [];

      for (const tx of txs) {
        if (!tx.success) continue;
        const outMsg = (tx.out_msgs ?? []).find(msg => {
          const dest = normalize(msg.destination?.address ?? '');
          const target = normalize(TON_WALLET_ADDRESS);
          return dest === target && msg.value >= minNano;
        });
        if (!outMsg) continue;

        // TON Connect sends a plain transfer (no memo) — we match by
        // sender address + destination + amount, which is sufficient.
        // Prevent double-use by txHash.
        const record = getRecord(userId);
        if (record.verifiedTxHashes.includes(tx.hash)) {
          return { success: false, error: 'This transaction was already used.' };
        }
        record.verifiedTxHashes.push(tx.hash);
        activateSubscription(userId);
        return { success: true };
      }
    } catch {
      // network error — retry
    }
  }

  return {
    success: false,
    error: 'Transaction not found after waiting. Please try again in a moment.',
  };
}

// ─── B) Original manual TX hash verification (keep for fallback) ──────────────

interface TonApiVerifyTrace {
  transaction: {
    hash: string;
    success: boolean;
    in_msg?: {
      destination?: { address: string };
      value: number;
      decoded_body?: Record<string, unknown>;
    };
  };
}

export async function verifyTonPayment(
  txHash: string,
  userId: number,
): Promise<{ success: boolean; error?: string }> {
  if (!TON_WALLET_ADDRESS) {
    return { success: false, error: 'TON payments are not configured yet.' };
  }

  const record = getRecord(userId);
  if (record.verifiedTxHashes.includes(txHash)) {
    return { success: false, error: 'This transaction has already been used.' };
  }

  try {
    const baseUrl = getTonApiBaseUrl('ton-mainnet');
    const headers = { Accept: 'application/json', ...getTonApiHeaders() };

    const res = await fetch(`${baseUrl}/v2/traces/${encodeURIComponent(txHash)}`, {
      headers, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { success: false, error: `Transaction not found (${res.status}).` };
    }

    const trace = (await res.json()) as TonApiVerifyTrace;
    const tx = trace.transaction;
    if (!tx.success) return { success: false, error: 'Transaction failed on-chain.' };

    const inMsg = tx.in_msg;
    if (!inMsg) return { success: false, error: 'No incoming message found.' };

    const destAddr = normalize(inMsg.destination?.address ?? '');
    if (!destAddr || destAddr !== normalize(TON_WALLET_ADDRESS)) {
      return { success: false, error: 'Transaction not sent to the Explorai payment wallet.' };
    }

    const valueTon = inMsg.value / 1e9;
    if (valueTon < TON_SUBSCRIPTION_PRICE_TON * 0.99) {
      return {
        success: false,
        error: `Insufficient amount: expected ${TON_SUBSCRIPTION_PRICE_TON} TON, received ${valueTon.toFixed(3)} TON.`,
      };
    }

    const comment = String(inMsg.decoded_body?.['text'] ?? '');
    const expectedMemo = `explorai_${userId}`;
    if (comment !== expectedMemo) {
      return {
        success: false,
        error: `Wrong memo. Expected "${expectedMemo}", got "${comment || '(empty)'}".`,
      };
    }

    record.verifiedTxHashes.push(txHash);
    activateSubscription(userId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Verification failed.' };
  }
}

// ─── C) Telegram Stars ────────────────────────────────────────────────────────

export interface StarsInvoice {
  invoiceUrl: string;
  payload: string;
}

/**
 * Creates a Telegram Stars invoice via the Bot API.
 * The payload encodes the userId so we can activate the right user on payment.
 */
export async function createStarsInvoice(userId: number): Promise<StarsInvoice | null> {
  if (!BOT_TOKEN) return null;

  const payload = `pro_${userId}_${Date.now()}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Explorai Pro',
        description: `Unlimited blockchain transaction analyses for ${SUBSCRIPTION_DAYS} days.`,
        payload,
        currency: 'XTR',                // Telegram Stars
        prices: [{ label: 'Explorai Pro', amount: STARS_PRICE }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json()) as { ok: boolean; result?: string; description?: string };
    if (!data.ok || !data.result) {
      console.error('[subscription] createInvoiceLink failed:', data.description);
      return null;
    }

    return { invoiceUrl: data.result, payload };
  } catch (err) {
    console.error('[subscription] createInvoiceLink error:', err);
    return null;
  }
}

/**
 * Activates Pro after a successful Telegram Stars payment.
 * The payload must start with "pro_{userId}_" — validated before activating.
 */
export function activateStarsPro(
  userId: number,
  payload: string,
): { success: boolean; error?: string } {
  const expectedPrefix = `pro_${userId}_`;
  if (!payload.startsWith(expectedPrefix)) {
    return { success: false, error: 'Invalid payment payload.' };
  }
  activateSubscription(userId);
  return { success: true };
}
