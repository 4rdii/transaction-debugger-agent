// Known Solana program ID → human-readable name mapping

export const SOLANA_PROGRAMS: Record<string, string> = {
  // ── Core ────────────────────────────────────────────────────────────────────
  '11111111111111111111111111111111':                         'System Program',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA':            'SPL Token',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb':            'SPL Token 2022',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL':           'Associated Token Account',
  'ComputeBudget111111111111111111111111111111':              'Compute Budget',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr':           'Memo v2',
  'Memo1UhkJBfCR6MNBgEEXBYnYJCyFjqQpEGLasfQ5s1f':          'Memo v1',
  'SysvarRent111111111111111111111111111111111':              'Sysvar Rent',
  'SysvarC1ock11111111111111111111111111111111':              'Sysvar Clock',

  // ── DEXes ──────────────────────────────────────────────────────────────────
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB':           'Jupiter V4',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4':           'Jupiter V6',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8':          'Raydium AMM',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK':          'Raydium CLMM',
  'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS':           'Raydium Route',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc':           'Orca Whirlpool',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP':          'Orca Swap V2',

  // ── Bridges ────────────────────────────────────────────────────────────────
  'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth':           'Wormhole Bridge',
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb':           'Wormhole Token Bridge',

  // ── NFT / Marketplaces ─────────────────────────────────────────────────────
  'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN':           'Tensor Swap',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s':           'Metaplex Token Metadata',
  'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K':           'Magic Eden V2',

  // ── Staking / Liquid Staking ───────────────────────────────────────────────
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD':           'Marinade Finance',
  'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy':           'Stake Pool',
  'Stake11111111111111111111111111111111111111':              'Stake Program',

  // ── Other ──────────────────────────────────────────────────────────────────
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX':           'OpenBook DEX',
};

/** Set of program IDs that are DEXes (for swap detection) */
export const SOLANA_DEX_PROGRAMS = new Set([
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',   // Jupiter V4
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',   // Jupiter V6
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',  // Raydium AMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',  // Raydium CLMM
  'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS',   // Raydium Route
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',   // Orca Whirlpool
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',  // Orca Swap V2
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',   // OpenBook DEX
]);

/** Set of program IDs that are bridges */
export const SOLANA_BRIDGE_PROGRAMS = new Set([
  'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',   // Wormhole Bridge
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',   // Wormhole Token Bridge
]);

/** Look up a program name by its ID. Returns undefined for unknown programs. */
export function lookupProgramName(programId: string): string | undefined {
  return SOLANA_PROGRAMS[programId];
}
