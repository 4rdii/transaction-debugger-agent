// Known TON contract addresses → human-readable name mapping
// Addresses use raw form (workchain:hex) as returned by TonAPI

export const TON_CONTRACTS: Record<string, string> = {
  // ── Jettons (major tokens — master contract addresses) ────────────────────
  'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs': 'USDT',
  'EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmwG9F6bO': 'STON',
  'EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE': 'SCALE',
  'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT': 'NOT',
  'EQB-MPwrd1G6WKNkLz_VnV6WqBDd142KMQv-g1O-8QUA3728': 'jUSDC',
  'EQBX6K9aXVl3nXINCyPPL86C4ONVmQ8pK68YQX-Po_RP4xjn': 'jUSDT',

  // Top Jettons by market cap / volume
  'EQCvxJy4eG8hyHBFsZ7DUdYCtzzpMnCGWus2ECnxQbA1DEAD': 'DEAD',
  'EQD0vdSA_NedR9uvbgN9EikRX-suesDxGeFg69XQMavfLqIw': 'BOLT',
  'EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA': 'jWBTC',
  'EQDcBkGHmC4pTf34x3Gm05XvepO5w60DNxZ-XT4I6-UGG5L5': 'jDAI',
  'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c': 'WTON',
  'EQBl3gg6AAGRVRf35GKn0k7OyKPTLPJsXmHa2LQ0VJQCMavf': 'PUNK',
  'EQC98_qAmNEptUtPc7W6xdHh_ZHrBUFpw5Ft_IzNU20QAJav': 'GRAM',
  'EQDQoc-hTMJG9RLXKI-q0pOGBb3FwrshQN2bIWJl0EM7_STo': 'DOGS',
  'EQAQXlWJvGbbFfE8F3oS8s87lIgdovS455IsWFaRdmJetTon': 'JETTON',
  'EQB02DJ0cdUD4iQDRbBv4aYG3htePHBRK1tGeRtCnatescbT': 'CATI',
  'EQAUz4INHK4R3BBUYR4l06bpmtUNXEBz8AveDKrE92iMtwJI': 'HMSTR',
  'EQD-cvR0Nz6XAyRBvbhz-abTrRC6sI5tvHvvpeQraV9UAAD3': 'DUST',
  'EQB8StgTQXidy32a8gfu0sMV0HafIEYPICGRVnqYkzMUaYHo': 'KINGY',
  'EQC61IQRl0_la95nfHgUHT0OFxm90HKPLLqhrGBBPnTJ5kEN': 'REDO',
  'EQCajaUU1XXSAjTD-xOV7pE49fGtg4q8kF3ELCOJtGvQFQ2C': 'MAJOR',
  'EQD4P1mljklbniYaaCVdfGBMZbJaumFEgrHEq5u0X0q_sSCy': 'FISH',

  // Stablecoins
  'EQC_a3sTN7NNmxvJw6MpsZ3ovrR_7xfCE-EEGxRLTjHt5JME': 'USDC',
  'EQDsBXqBVkECbZSMaKdq7YiGmLe7fDU3qrjWNh51HE1XeGRC': 'DAI',

  // ── DEXes ──────────────────────────────────────────────────────────────────
  'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt': 'Ston.fi Router v1',
  'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67': 'Ston.fi Router v2',
  'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_': 'DeDust Vault',
  'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YADB_': 'DeDust Factory',
  'EQDhIloDq2m5kbZ1F9v_JOm_ZdJjRITUiO7Rn3bMR-nVbLTY': 'DeDust Router',

  // ── Bridges ────────────────────────────────────────────────────────────────
  'EQCzFTqhg-_9jUMsmRMkleR0wWqDue7AZ_DExCiO4MiZcJFl': 'TON Bridge (ETH)',
  'EQDPdq8xjAhytYqfGSX8KcFgor4lTsS1Vs2qGxCzNeqpJd-b': 'TON Bridge (BSC)',

  // ── Infrastructure ─────────────────────────────────────────────────────────
  'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2': 'Getgems Marketplace',
  'EQCA14o1-VWhS2efqoh_9M1b_A9DtKTuoqfmkn83AbJzwnPi': 'TON DNS',
  'EQC_1YoM8RBixN95lz7odcF3Vrkc_N8Ne7gQi7Abtlet_Efi': 'Megaton Finance',
};

/** Known DEX router/vault contracts */
export const TON_DEX_CONTRACTS = new Set([
  'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',  // Ston.fi Router v1
  'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67',  // Ston.fi Router v2
  'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_',  // DeDust Vault
  'EQDhIloDq2m5kbZ1F9v_JOm_ZdJjRITUiO7Rn3bMR-nVbLTY',  // DeDust Router
  'EQC_1YoM8RBixN95lz7odcF3Vrkc_N8Ne7gQi7Abtlet_Efi',  // Megaton Finance
]);

/** Known bridge contracts */
export const TON_BRIDGE_CONTRACTS = new Set([
  'EQCzFTqhg-_9jUMsmRMkleR0wWqDue7AZ_DExCiO4MiZcJFl',  // TON Bridge (ETH)
  'EQDPdq8xjAhytYqfGSX8KcFgor4lTsS1Vs2qGxCzNeqpJd-b',  // TON Bridge (BSC)
]);

/** Known TON op-codes (32-bit operation IDs from message body) */
export const TON_OP_CODES: Record<number, string> = {
  // Jetton standard (TEP-74)
  0x0f8a7ea5: 'jetton_transfer',
  0x178d4519: 'jetton_internal_transfer',
  0x7362d09c: 'jetton_transfer_notification',
  0xd53276db: 'jetton_excesses',
  0x595f07bc: 'jetton_burn',
  0x7bdd97de: 'jetton_burn_notification',

  // NFT standard (TEP-62)
  0x5fcc3d14: 'nft_transfer',
  0x05138d91: 'nft_ownership_assigned',
  0x6f89f36e: 'nft_get_static_data',
  0x8b771735: 'nft_report_static_data',

  // Common wallet operations
  0x00000000: 'simple_transfer',
  0xd4caed54: 'comment_transfer',

  // Ston.fi DEX
  0x25938561: 'stonfi_swap',
  0xf93bb43f: 'stonfi_provide_liquidity',

  // DeDust DEX
  0xea06185d: 'dedust_swap',
  0x40e108d6: 'dedust_deposit',
};

/** Look up a contract name by its address. Returns undefined for unknown. */
export function lookupTonContractName(address: string): string | undefined {
  return TON_CONTRACTS[address];
}

/** Look up an op-code name. Returns hex string if unknown. */
export function lookupTonOpCode(opCode: number | null | undefined): string | undefined {
  if (opCode == null) return undefined;
  return TON_OP_CODES[opCode];
}
