import type { AnalysisResult } from '@debugger/shared';

const MAX_ENTRIES = 200;
const TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  result: AnalysisResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(txHash: string, networkId: string): string {
  return `${txHash.toLowerCase()}-${networkId}`;
}

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export function getCached(txHash: string, networkId: string): AnalysisResult | null {
  const entry = cache.get(cacheKey(txHash, networkId));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey(txHash, networkId));
    return null;
  }
  return entry.result;
}

export function setCached(txHash: string, networkId: string, result: AnalysisResult): void {
  // Evict expired entries and enforce max size
  evictExpired();
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(cacheKey(txHash, networkId), { result, expiresAt: Date.now() + TTL_MS });
}

export function getCachedByHash(txHash: string): AnalysisResult | null {
  const key = txHash.toLowerCase();
  const now = Date.now();
  for (const [k, entry] of cache) {
    if (k.startsWith(key) && entry.expiresAt > now) return entry.result;
  }
  return null;
}
