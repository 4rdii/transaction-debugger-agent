import { describe, it, expect } from 'vitest';
import { lookupKnownError, hasKnownErrors } from '../registry/solana-errors.js';
import { parseInstructionError, getFailingProgramId } from '../services/solana-idl.service.js';

describe('solana-errors registry', () => {
  it('looks up Jupiter V6 SlippageToleranceExceeded (0x1771 = 6001)', () => {
    const err = lookupKnownError('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 6001);
    expect(err).toBeDefined();
    expect(err!.name).toBe('SlippageToleranceExceeded');
    expect(err!.message).toContain('Slippage');
  });

  it('looks up Jupiter V6 EmptyRoute (6000)', () => {
    const err = lookupKnownError('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 6000);
    expect(err).toBeDefined();
    expect(err!.name).toBe('EmptyRoute');
  });

  it('looks up Raydium AMM ExceededSlippage', () => {
    const err = lookupKnownError('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 6016);
    expect(err).toBeDefined();
    expect(err!.name).toBe('ExceededSlippage');
  });

  it('looks up Raydium CLMM TooLittleOutputReceived', () => {
    const err = lookupKnownError('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 6022);
    expect(err).toBeDefined();
    expect(err!.name).toBe('TooLittleOutputReceived');
  });

  it('looks up Orca Whirlpool TokenMinSubceeded', () => {
    const err = lookupKnownError('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 6018);
    expect(err).toBeDefined();
    expect(err!.name).toBe('TokenMinSubceeded');
  });

  it('looks up SPL Token InsufficientFunds', () => {
    const err = lookupKnownError('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1);
    expect(err).toBeDefined();
    expect(err!.name).toBe('InsufficientFunds');
  });

  it('looks up System Program AccountAlreadyInUse', () => {
    const err = lookupKnownError('11111111111111111111111111111111', 0);
    expect(err).toBeDefined();
    expect(err!.name).toBe('AccountAlreadyInUse');
  });

  it('returns undefined for unknown program', () => {
    expect(lookupKnownError('UnknownProgram123', 6001)).toBeUndefined();
  });

  it('returns undefined for unknown error code on known program', () => {
    expect(lookupKnownError('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 9999)).toBeUndefined();
  });

  it('hasKnownErrors returns true for known programs', () => {
    expect(hasKnownErrors('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')).toBe(true);
    expect(hasKnownErrors('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBe(true);
    expect(hasKnownErrors('11111111111111111111111111111111')).toBe(true);
  });

  it('hasKnownErrors returns false for unknown programs', () => {
    expect(hasKnownErrors('UnknownProgramXYZ')).toBe(false);
  });
});

describe('parseInstructionError', () => {
  it('parses InstructionError with Custom code', () => {
    const result = parseInstructionError({ InstructionError: [2, { Custom: 6001 }] });
    expect(result).toEqual({ instructionIndex: 2, customCode: 6001 });
  });

  it('parses InstructionError with builtin string error', () => {
    const result = parseInstructionError({ InstructionError: [0, 'InvalidAccountData'] });
    expect(result).toEqual({ instructionIndex: 0, builtinError: 'InvalidAccountData' });
  });

  it('returns null for null/undefined input', () => {
    expect(parseInstructionError(null)).toBeNull();
    expect(parseInstructionError(undefined)).toBeNull();
  });

  it('returns null for non-InstructionError', () => {
    expect(parseInstructionError({ SomeOtherError: 'foo' })).toBeNull();
    expect(parseInstructionError('string error')).toBeNull();
  });

  it('handles malformed InstructionError gracefully', () => {
    expect(parseInstructionError({ InstructionError: [] })).toBeNull();
    expect(parseInstructionError({ InstructionError: [0] })).toBeNull();
  });
});

describe('getFailingProgramId', () => {
  const instructions = [
    { programId: 'ComputeBudget111111111111111111111111111111' },
    { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' },
    { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
  ];

  it('returns the correct program for a given instruction index', () => {
    expect(getFailingProgramId(instructions, 1)).toBe('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
    expect(getFailingProgramId(instructions, 0)).toBe('ComputeBudget111111111111111111111111111111');
  });

  it('returns undefined for out-of-bounds index', () => {
    expect(getFailingProgramId(instructions, 99)).toBeUndefined();
  });
});
