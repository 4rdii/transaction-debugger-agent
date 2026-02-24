import type { AnalysisResult } from '@debugger/shared';

// In-memory cache keyed by `${txHash.toLowerCase()}-${networkId}`
const cache = new Map<string, AnalysisResult>();

function cacheKey(txHash: string, networkId: string): string {
  return `${txHash.toLowerCase()}-${networkId}`;
}

export function getCached(txHash: string, networkId: string): AnalysisResult | null {
  return cache.get(cacheKey(txHash, networkId)) ?? null;
}

export function setCached(txHash: string, networkId: string, result: AnalysisResult): void {
  cache.set(cacheKey(txHash, networkId), result);
}

export function getCachedByHash(txHash: string): AnalysisResult | null {
  const key = txHash.toLowerCase();
  for (const [k, v] of cache) {
    if (k.startsWith(key)) return v;
  }
  return null;
}

export function getCacheSize(): number {
  return cache.size;
}
