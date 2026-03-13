import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cache module uses module-level state (a Map). To isolate tests we
// re-import it fresh or reset it between runs.  Since the Map is private
// we rely on the public API and fake timers.

// We need to dynamically import so we can reset module state between tests.
// But vitest caches modules, so we use vi.resetModules() + dynamic import.
async function loadCache() {
  const mod = await import('../services/cache.service.js');
  return mod;
}

import type { AnalysisResult } from '@debugger/shared';

function makeResult(txHash: string, networkId = '1'): AnalysisResult {
  return {
    txHash,
    networkId,
    success: true,
    gasUsed: 21_000,
    blockNumber: 1_000_000,
    callTree: {
      id: 'call-0',
      depth: 0,
      callType: 'CALL',
      caller: '0xaaa',
      callee: '0xbbb',
      decodedInputs: [],
      decodedOutputs: [],
      gasUsed: 21_000,
      valueWei: '0x0',
      success: true,
      children: [],
    },
    tokenFlows: [],
    semanticActions: [],
    riskFlags: [],
    llmExplanation: 'test explanation',
    addressLabels: {},
    analyzedAt: new Date().toISOString(),
  };
}

describe('cache.service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  // ── Basic round-trip ───────────────────────────────────────────────────

  it('setCached / getCached round-trip', async () => {
    const { setCached, getCached } = await loadCache();
    const result = makeResult('0xabc123', '1');

    setCached('0xabc123', '1', result);
    const cached = getCached('0xabc123', '1');

    expect(cached).toEqual(result);
  });

  it('getCached is case-insensitive on txHash', async () => {
    const { setCached, getCached } = await loadCache();
    const result = makeResult('0xABC123', '1');

    setCached('0xABC123', '1', result);

    expect(getCached('0xabc123', '1')).toEqual(result);
  });

  // ── Missing keys ──────────────────────────────────────────────────────

  it('getCached returns null for missing keys', async () => {
    const { getCached } = await loadCache();

    expect(getCached('0xnonexistent', '1')).toBeNull();
  });

  it('getCached returns null when networkId differs', async () => {
    const { setCached, getCached } = await loadCache();

    setCached('0xabc', '1', makeResult('0xabc', '1'));

    expect(getCached('0xabc', '137')).toBeNull();
  });

  // ── getCachedByHash partial matching ──────────────────────────────────

  it('getCachedByHash matches by txHash prefix regardless of networkId', async () => {
    const { setCached, getCachedByHash } = await loadCache();
    const result = makeResult('0xabc', '42161');

    setCached('0xabc', '42161', result);

    const found = getCachedByHash('0xabc');
    expect(found).toEqual(result);
  });

  it('getCachedByHash is case-insensitive', async () => {
    const { setCached, getCachedByHash } = await loadCache();

    setCached('0xDEADBEEF', '1', makeResult('0xDEADBEEF', '1'));

    expect(getCachedByHash('0xdeadbeef')).not.toBeNull();
  });

  it('getCachedByHash returns null when nothing matches', async () => {
    const { getCachedByHash } = await loadCache();

    expect(getCachedByHash('0xunknown')).toBeNull();
  });

  // ── TTL expiration ────────────────────────────────────────────────────

  it('expires entries after TTL (1 hour)', async () => {
    vi.useFakeTimers();

    const { setCached, getCached } = await loadCache();
    const result = makeResult('0xtimed', '1');

    setCached('0xtimed', '1', result);
    expect(getCached('0xtimed', '1')).toEqual(result);

    // Advance time past 1 hour TTL
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    expect(getCached('0xtimed', '1')).toBeNull();
  });

  it('returns cached entry before TTL expires', async () => {
    vi.useFakeTimers();

    const { setCached, getCached } = await loadCache();

    setCached('0xfresh', '1', makeResult('0xfresh', '1'));

    // Advance time to just under 1 hour
    vi.advanceTimersByTime(59 * 60 * 1000);

    expect(getCached('0xfresh', '1')).not.toBeNull();
  });

  it('getCachedByHash respects TTL', async () => {
    vi.useFakeTimers();

    const { setCached, getCachedByHash } = await loadCache();

    setCached('0xexpiring', '1', makeResult('0xexpiring', '1'));

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    expect(getCachedByHash('0xexpiring')).toBeNull();
  });

  // ── Max entries eviction ──────────────────────────────────────────────

  it('evicts oldest entry when cache exceeds 200 entries', async () => {
    const { setCached, getCached } = await loadCache();

    // Fill cache to max (200)
    for (let i = 0; i < 200; i++) {
      setCached(`0x${i.toString(16).padStart(4, '0')}`, '1', makeResult(`0x${i.toString(16).padStart(4, '0')}`, '1'));
    }

    // The very first entry should still be present
    expect(getCached('0x0000', '1')).not.toBeNull();

    // Adding one more should evict the oldest (0x0000)
    setCached('0xoverflow', '1', makeResult('0xoverflow', '1'));

    expect(getCached('0x0000', '1')).toBeNull();
    expect(getCached('0xoverflow', '1')).not.toBeNull();
  });

  it('expired entries are evicted before size-based eviction', async () => {
    vi.useFakeTimers();

    const { setCached, getCached } = await loadCache();

    // Add one entry that will expire
    setCached('0xwillexpire', '1', makeResult('0xwillexpire', '1'));

    // Advance past TTL
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    // Fill up to 200 (the expired one will be cleaned during setCached)
    for (let i = 0; i < 200; i++) {
      setCached(`0x${i.toString(16).padStart(4, '0')}`, '1', makeResult(`0x${i.toString(16).padStart(4, '0')}`, '1'));
    }

    // The expired entry is gone
    expect(getCached('0xwillexpire', '1')).toBeNull();
    // All 200 fresh entries should be intact (the expired one freed a slot)
    expect(getCached('0x0000', '1')).not.toBeNull();
    expect(getCached(`0x${(199).toString(16).padStart(4, '0')}`, '1')).not.toBeNull();
  });
});
