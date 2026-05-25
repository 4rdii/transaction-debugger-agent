/**
 * Subscription service — free tier limits + TON pro plan.
 *
 * Free tier : 5 analyses / day per Telegram user.
 * Pro tier  : unlimited analyses. Activated via TON payment ($9/month).
 *
 * State is persisted to SUBSCRIPTION_STORE_PATH (default: ./subscription-store.json)
 * so subscriptions survive server restarts.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getTonApiBaseUrl, getTonApiHeaders } from '../config.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const FREE_TOTAL_LIMIT = 5;   // lifetime free analyses before paywall
const SUBSCRIPTION_DAYS = 30;
const TON_SUBSCRIPTION_PRICE_TON = parseFloat(process.env['TON_SUBSCRIPTION_PRICE'] ?? '3');
const TON_WALLET_ADDRESS = process.env['TON_WALLET_ADDRESS'] ?? '';
const STORE_PATH = process.env['SUBSCRIPTION_STORE_PATH'] ?? './subscription-store.json';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubscriptionRecord {
  userId: number;
  plan: 'free' | 'pro';
  proExpiresAt?: string;       // ISO timestamp
  totalFreeCount: number;      // lifetime free analyses used
  verifiedTxHashes: string[];  // prevent double-spend of a tx hash
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

// Load on module init
loadStore();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getRecord(userId: number): SubscriptionRecord {
  const key = String(userId);
  if (!storeData.subscriptions[key]) {
    storeData.subscriptions[key] = {
      userId,
      plan: 'free',
      totalFreeCount: 0,
      verifiedTxHashes: [],
    };
  }
  return storeData.subscriptions[key]!;
}

// ─── Public read API ──────────────────────────────────────────────────────────

export function isProUser(userId: number): boolean {
  const record = getRecord(userId);
  if (record.plan !== 'pro' || !record.proExpiresAt) return false;
  return new Date(record.proExpiresAt) > new Date();
}

export function getFreeCount(userId: number): number {
  const record = getRecord(userId);
  return record.totalFreeCount ?? 0;
}

export interface UsageStatus {
  plan: 'free' | 'pro';
  isPro: boolean;
  used: number;
  remaining: number | null; // null = unlimited (pro)
  limit: number | null;     // null = unlimited (pro)
  proExpiresAt?: string;
  allowed: boolean;
}

export function getUsageStatus(userId: number): UsageStatus {
  const isPro = isProUser(userId);
  const record = getRecord(userId);
  const used = record.totalFreeCount ?? 0;
  if (isPro) {
    return {
      plan: 'pro',
      isPro: true,
      used,
      remaining: null,
      limit: null,
      proExpiresAt: record.proExpiresAt,
      allowed: true,
    };
  }
  const remaining = Math.max(0, FREE_TOTAL_LIMIT - used);
  return {
    plan: 'free',
    isPro: false,
    used,
    remaining,
    limit: FREE_TOTAL_LIMIT,
    allowed: remaining > 0,
  };
}

// ─── Public write API ─────────────────────────────────────────────────────────

export function incrementFreeCount(userId: number): void {
  const record = getRecord(userId);
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
  configured: boolean;
}

export function getPaymentInfo(userId: number): PaymentInfo {
  return {
    walletAddress: TON_WALLET_ADDRESS,
    amountTon: TON_SUBSCRIPTION_PRICE_TON,
    memo: `explorai_${userId}`,
    durationDays: SUBSCRIPTION_DAYS,
    priceUsd: 9,
    configured: Boolean(TON_WALLET_ADDRESS),
  };
}

// ─── TON payment verification ──────────────────────────────────────────────────

interface TonApiVerifyTrace {
  transaction: {
    hash: string;
    success: boolean;
    in_msg?: {
      destination?: { address: string };
      value: number;
      decoded_op_name?: string;
      decoded_body?: Record<string, unknown>;
    };
  };
}

/**
 * Verifies a TON payment transaction and activates the subscription if valid.
 *
 * Checks:
 * 1. Transaction succeeded on-chain
 * 2. Destination address = TON_WALLET_ADDRESS
 * 3. Amount >= TON_SUBSCRIPTION_PRICE_TON (with 1% tolerance)
 * 4. Comment (memo) = "explorai_{userId}"
 * 5. txHash not already used
 */
export async function verifyTonPayment(
  txHash: string,
  userId: number,
): Promise<{ success: boolean; error?: string }> {
  if (!TON_WALLET_ADDRESS) {
    return { success: false, error: 'TON payments are not configured yet.' };
  }

  const record = getRecord(userId);

  // Prevent double-use
  if (record.verifiedTxHashes.includes(txHash)) {
    return { success: false, error: 'This transaction has already been used to activate a subscription.' };
  }

  try {
    const baseUrl = getTonApiBaseUrl('ton-mainnet');
    const headers = getTonApiHeaders();

    const res = await fetch(`${baseUrl}/v2/traces/${encodeURIComponent(txHash)}`, {
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        success: false,
        error: `Transaction not found (${res.status}). Make sure you copied the correct tx hash.`,
      };
    }

    const trace = (await res.json()) as TonApiVerifyTrace;
    const tx = trace.transaction;

    if (!tx.success) {
      return { success: false, error: 'This transaction failed on-chain.' };
    }

    const inMsg = tx.in_msg;
    if (!inMsg) {
      return { success: false, error: 'No incoming message found in this transaction.' };
    }

    // Normalize addresses: strip "0:" prefix and lowercase for comparison
    const normalize = (addr: string) => addr.toLowerCase().replace(/^0:/, '');
    const destAddr = normalize(inMsg.destination?.address ?? '');
    const expectedAddr = normalize(TON_WALLET_ADDRESS);

    if (!destAddr || destAddr !== expectedAddr) {
      return { success: false, error: 'This transaction was not sent to the Explorai payment wallet.' };
    }

    // Amount check: value is in nanoTON
    const valueTon = inMsg.value / 1e9;
    const minRequired = TON_SUBSCRIPTION_PRICE_TON * 0.99; // 1% tolerance
    if (valueTon < minRequired) {
      return {
        success: false,
        error: `Insufficient amount: expected ${TON_SUBSCRIPTION_PRICE_TON} TON, received ${valueTon.toFixed(3)} TON.`,
      };
    }

    // Memo check
    const comment = String(inMsg.decoded_body?.['text'] ?? '');
    const expectedMemo = `explorai_${userId}`;
    if (comment !== expectedMemo) {
      return {
        success: false,
        error: `Wrong memo. Expected "${expectedMemo}", got "${comment || '(empty)'}". Make sure you copied the memo exactly.`,
      };
    }

    // All checks passed — mark tx as used and activate
    record.verifiedTxHashes.push(txHash);
    activateSubscription(userId);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Verification failed. Please try again.',
    };
  }
}
