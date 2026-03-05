import { describe, it, expect } from 'vitest';
import {
  SOLANA_PROGRAMS,
  SOLANA_DEX_PROGRAMS,
  SOLANA_BRIDGE_PROGRAMS,
  lookupProgramName,
} from '../registry/solana-programs.js';

describe('solana-programs registry', () => {
  it('looks up known programs by ID', () => {
    expect(lookupProgramName('11111111111111111111111111111111')).toBe('System Program');
    expect(lookupProgramName('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBe('SPL Token');
    expect(lookupProgramName('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')).toBe('Jupiter V6');
  });

  it('returns undefined for unknown programs', () => {
    expect(lookupProgramName('UnknownProgramId12345678901234567890')).toBeUndefined();
    expect(lookupProgramName('')).toBeUndefined();
  });

  it('DEX set contains all expected DEX programs', () => {
    expect(SOLANA_DEX_PROGRAMS.has('JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB')).toBe(true);
    expect(SOLANA_DEX_PROGRAMS.has('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')).toBe(true);
    expect(SOLANA_DEX_PROGRAMS.has('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')).toBe(true);
    expect(SOLANA_DEX_PROGRAMS.has('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc')).toBe(true);
  });

  it('DEX set does not contain non-DEX programs', () => {
    expect(SOLANA_DEX_PROGRAMS.has('11111111111111111111111111111111')).toBe(false);
    expect(SOLANA_DEX_PROGRAMS.has('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBe(false);
  });

  it('bridge set contains Wormhole programs', () => {
    expect(SOLANA_BRIDGE_PROGRAMS.has('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth')).toBe(true);
    expect(SOLANA_BRIDGE_PROGRAMS.has('wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb')).toBe(true);
  });

  it('all DEX programs exist in the main registry', () => {
    for (const id of SOLANA_DEX_PROGRAMS) {
      expect(SOLANA_PROGRAMS[id]).toBeDefined();
    }
  });

  it('all bridge programs exist in the main registry', () => {
    for (const id of SOLANA_BRIDGE_PROGRAMS) {
      expect(SOLANA_PROGRAMS[id]).toBeDefined();
    }
  });
});
