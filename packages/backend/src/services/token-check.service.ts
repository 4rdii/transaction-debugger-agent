/**
 * Token maliciousness / quirk checker.
 *
 * Fetches verified source from Etherscan and scans for patterns that indicate
 * fee-on-transfer, honeypot, blacklist, hidden mint, max-tx limits, and other
 * behaviours that commonly cause DeFi transaction failures.
 *
 * This is a static-analysis heuristic — it flags *patterns*, not proof of malice.
 */

import { getContractSource, type ContractSource } from './etherscan.service.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type TokenFlagLevel = 'info' | 'warning' | 'danger';

export interface TokenFlag {
  level: TokenFlagLevel;
  type: string;
  description: string;
  /** Matched snippet (truncated) for evidence */
  evidence?: string;
}

export interface TokenCheckResult {
  address: string;
  networkId: number;
  contractName: string | null;
  verified: boolean;
  flags: TokenFlag[];
}

// ── Pattern definitions ──────────────────────────────────────────────────────

interface PatternDef {
  type: string;
  level: TokenFlagLevel;
  /** Regex to run against the *full* concatenated source */
  pattern: RegExp;
  description: string;
}

const PATTERNS: PatternDef[] = [
  // ── Fee-on-transfer ────────────────────────────────────────────────────────
  {
    type: 'FEE_ON_TRANSFER',
    level: 'warning',
    pattern: /\b(taxFee|liquidityFee|_fee|_taxFee|sellFee|buyFee|transferFee|_feeRate|feePercent|_taxRate|reflectionFee|marketingFee|devFee|burnFee)\b/i,
    description: 'Token has fee-related state variables — likely a fee-on-transfer (FoT) token. DEX routers may receive less than expected, causing swaps to revert.',
  },
  {
    type: 'FEE_ON_TRANSFER',
    level: 'warning',
    pattern: /\b_?takeFee\b|\btotalFees?\b.*?[+\-*/]|\bfeeAmount\s*=\s*.*?[*/]/i,
    description: 'Transfer function applies a fee calculation — tokens deducted on transfer.',
  },

  // ── Honeypot / sell restrictions ───────────────────────────────────────────
  {
    type: 'HONEYPOT_RISK',
    level: 'danger',
    pattern: /\b(canSell|allowSell|sellEnabled|tradingEnabled|tradingOpen|_canTrade|swapEnabled)\b\s*[=;]/i,
    description: 'Token has a sell/trading toggle controlled by the owner — potential honeypot (owner can disable selling).',
  },
  {
    type: 'SELL_COOLDOWN',
    level: 'warning',
    pattern: /\bcooldown\b.*?\btransfer\b|\btransfer\b.*?\bcooldown\b|\b_cooldownTime\b|\bcooldownEnabled\b/i,
    description: 'Token enforces a cooldown between transfers — may cause rapid-succession swaps to fail.',
  },

  // ── Blacklist / whitelist ──────────────────────────────────────────────────
  {
    type: 'BLACKLIST',
    level: 'warning',
    pattern: /\b(isBlacklisted|_blacklist|blacklisted|blackList|_isBlackListed|bannedAddress|isBlocked)\b/i,
    description: 'Token has a blacklist mechanism — certain addresses can be blocked from transferring.',
  },
  {
    type: 'WHITELIST_ONLY',
    level: 'warning',
    pattern: /\b(isWhitelisted|_whitelist|whitelisted|whiteList|onlyWhitelisted)\b/i,
    description: 'Token uses a whitelist — only approved addresses may transfer.',
  },

  // ── Max-tx / max-wallet limits ─────────────────────────────────────────────
  {
    type: 'MAX_TX_LIMIT',
    level: 'warning',
    pattern: /\b(maxTxAmount|_maxTxAmount|maxTransactionAmount|maxTx|maxTransferAmount)\b/i,
    description: 'Token enforces a maximum transfer amount per transaction — large swaps may revert.',
  },
  {
    type: 'MAX_WALLET_LIMIT',
    level: 'info',
    pattern: /\b(maxWalletAmount|_maxWallet|maxWalletSize|maxWalletToken|maxHoldingAmount)\b/i,
    description: 'Token enforces a maximum wallet holding — transfers exceeding the cap will revert.',
  },

  // ── Hidden mint ────────────────────────────────────────────────────────────
  {
    type: 'HIDDEN_MINT',
    level: 'danger',
    pattern: /function\s+mint\s*\(.*?\)\s*(external|public)\b(?!.*\bonlyMinter\b)/i,
    description: 'Token has a public mint function without clear access control — anyone (or the owner) may inflate supply.',
  },
  {
    type: 'OWNER_MINT',
    level: 'warning',
    pattern: /function\s+mint\s*\(.*?\)\s*(external|public)\s+(onlyOwner|onlyRole)/i,
    description: 'Token owner can mint new tokens at will — inflationary risk.',
  },

  // ── Proxy / upgradeable ────────────────────────────────────────────────────
  {
    type: 'UPGRADEABLE_TOKEN',
    level: 'info',
    pattern: /\b(Upgradeable|TransparentUpgradeableProxy|UUPSUpgradeable|_upgradeTo)\b/i,
    description: 'Token uses an upgradeable proxy — logic can be changed by the admin.',
  },

  // ── Rebasing ───────────────────────────────────────────────────────────────
  {
    type: 'REBASE_TOKEN',
    level: 'warning',
    pattern: /\b(rebase|_rebase|rebaseIndex|scalingFactor|_gonsPerFragment)\b/i,
    description: 'Token is a rebase/elastic-supply token — balances change automatically, which breaks many DEX integrations.',
  },

  // ── Transfer hooks / overrides that may trap funds ─────────────────────────
  {
    type: 'CUSTOM_TRANSFER_LOGIC',
    level: 'info',
    pattern: /function\s+_transfer\s*\(.*?\)\s*(internal|private|override).*?\{[\s\S]{30,}require\(/im,
    description: 'Token overrides _transfer with custom require() checks — transfers may fail under non-obvious conditions.',
  },

  // ── Pausable ───────────────────────────────────────────────────────────────
  {
    type: 'PAUSABLE',
    level: 'info',
    pattern: /\b(whenNotPaused|_pause|Pausable|paused\(\))\b/i,
    description: 'Token is pausable — owner can freeze all transfers.',
  },

  // ── External call in transfer (reentrancy / callback risk) ─────────────────
  {
    type: 'EXTERNAL_CALL_IN_TRANSFER',
    level: 'warning',
    pattern: /function\s+_?transfer\b[\s\S]{0,500}\.call\{/im,
    description: 'Transfer function makes an external .call{} — possible reentrancy vector or unexpected gas consumption.',
  },
];

// ── Main check function ──────────────────────────────────────────────────────

export async function checkToken(
  address: string,
  networkId: number,
): Promise<TokenCheckResult> {
  const result: TokenCheckResult = {
    address,
    networkId,
    contractName: null,
    verified: false,
    flags: [],
  };

  const source = await getContractSource(address, networkId);

  // If source is a string, it's an error message
  if (typeof source === 'string') {
    result.flags.push({
      level: 'danger',
      type: 'UNVERIFIED_SOURCE',
      description: `Contract source is not verified on Etherscan — impossible to audit token behaviour. ${source}`,
    });
    return result;
  }

  const cs = source as ContractSource;
  result.contractName = cs.contractName;
  result.verified = true;

  // Concatenate all source files for pattern matching
  const fullSource = cs.files.map(f => f.content).join('\n\n');

  for (const pat of PATTERNS) {
    const match = pat.pattern.exec(fullSource);
    if (match) {
      const start = Math.max(0, match.index - 30);
      const end = Math.min(fullSource.length, match.index + match[0].length + 30);
      const snippet = fullSource.slice(start, end).replace(/\n/g, ' ').trim();

      result.flags.push({
        level: pat.level,
        type: pat.type,
        description: pat.description,
        evidence: snippet.length > 120 ? snippet.slice(0, 120) + '…' : snippet,
      });
    }
  }

  if (result.flags.length === 0) {
    result.flags.push({
      level: 'info',
      type: 'CLEAN',
      description: 'No suspicious patterns detected in verified source code.',
    });
  }

  return result;
}
