import type {
  RangoSwapStep,
  RangoResolvedTx,
  RangoSwapOverview,
} from '@debugger/shared';

// ── Chain name → debugger networkId mapping ──────────────────────────
const RANGO_CHAIN_TO_NETWORK_ID: Record<string, string> = {
  ETH: '1',
  BSC: '56',
  POLYGON: '137',
  ARBITRUM: '42161',
  OPTIMISM: '10',
  BASE: '8453',
  LINEA: '59144',
  AVAX_CCHAIN: '43114',
  ZKSYNC: '324',
  BLAST: '81457',
  SCROLL: '534352',
  FANTOM: '250',
  GNOSIS: '100',
  BERACHAIN: '80094',
  CELO: '42220',
  SOLANA: 'solana-mainnet',
};

/** Map a Rango chain name to a debugger networkId (or null if unsupported). */
export function mapChainToNetworkId(chain: string): string | null {
  return RANGO_CHAIN_TO_NETWORK_ID[chain.toUpperCase()] ?? null;
}

// ── HTML / RSC payload parsing helpers ───────────────────────────────

/** Unescape a JS string literal (handles \\", \\\\, \\n, \\t). */
function unescapeJsString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Extract all `self.__next_f.push([1,"..."])` string payloads from the HTML,
 * unescape them, and return as an array.
 */
function extractPushPayloads(html: string): string[] {
  const payloads: string[] = [];
  const marker = 'self.__next_f.push([1,"';
  let pos = 0;

  while (true) {
    const start = html.indexOf(marker, pos);
    if (start === -1) break;

    const contentStart = start + marker.length;
    let i = contentStart;
    // Walk forward, respecting escaped characters, until closing quote
    while (i < html.length) {
      if (html[i] === '\\') {
        i += 2; // skip escaped char
      } else if (html[i] === '"') {
        break;
      } else {
        i++;
      }
    }

    payloads.push(unescapeJsString(html.substring(contentStart, i)));
    pos = i + 1;
  }

  return payloads;
}

/**
 * Starting from an opening `{`, extract a balanced JSON object string.
 * Handles nested braces and strings with escaped characters.
 */
function extractJsonObject(text: string, startIndex: number): string | null {
  if (text[startIndex] !== '{') return null;
  let depth = 0;
  let inString = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.substring(startIndex, i + 1);
      }
    }
  }
  return null;
}

/** Extract a tx hash from an explorer URL like `https://etherscan.io/tx/0xabc...` */
function extractTxHashFromUrl(url: string): string | null {
  const match = url.match(/\/tx\/([^/?#]+)/);
  return match ? match[1] : null;
}

// ── Step parsing ─────────────────────────────────────────────────────

interface RawStep {
  swapper: { swapperId: string; swapperTitle: string; swapperType: string };
  from: {
    blockchainData: { blockchain: string; type: string; shortName: string; displayName: string };
    symbol: string;
    expectedAmount: number;
    realAmount: number;
  };
  to: {
    blockchainData: { blockchain: string; type: string; shortName: string; displayName: string };
    symbol: string;
    expectedAmount: number;
    realAmount: number;
  };
  status: string;
  generatedTxId?: string[];
  explorerUrls?: Array<{ url: string; description: string }>;
}

function parseStepsFromPayloads(fullText: string): RawStep[] {
  const steps: RawStep[] = [];
  const stepPattern = '"step":';
  let searchPos = 0;

  while (true) {
    const idx = fullText.indexOf(stepPattern, searchPos);
    if (idx === -1) break;

    const objStart = fullText.indexOf('{', idx + stepPattern.length);
    if (objStart === -1) break;

    const json = extractJsonObject(fullText, objStart);
    if (json) {
      try {
        const parsed = JSON.parse(json) as RawStep;
        // Verify it has the expected structure
        if (parsed.swapper && parsed.from && parsed.to) {
          // Deduplicate: skip if we already have a step with the same swapperId and status
          const isDuplicate = steps.some(
            s => s.swapper.swapperId === parsed.swapper.swapperId
              && s.status === parsed.status
              && JSON.stringify(s.generatedTxId) === JSON.stringify(parsed.generatedTxId),
          );
          if (!isDuplicate) steps.push(parsed);
        }
      } catch { /* skip malformed JSON */ }
    }
    searchPos = idx + 1;
  }

  return steps;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Resolve a Rango swap ID by fetching the explorer page and extracting
 * swap step data from the embedded RSC payloads.
 */
export async function resolveRangoSwap(swapId: string): Promise<RangoSwapOverview> {
  const url = `https://explorer.rango.exchange/swap/${swapId}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TxDebugger/1.0)',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Rango explorer returned HTTP ${res.status} for swap ${swapId}`);
  }

  const html = await res.text();

  // Extract and unescape all RSC payloads
  const payloads = extractPushPayloads(html);
  if (payloads.length === 0) {
    throw new Error('No RSC payloads found in Rango explorer page. The page format may have changed.');
  }

  const fullText = payloads.join('\n');

  // Parse step objects from the concatenated payloads
  const rawSteps = parseStepsFromPayloads(fullText);
  if (rawSteps.length === 0) {
    throw new Error('No swap steps found in Rango explorer page. The swap ID may be invalid.');
  }

  // Build normalized steps and resolved transactions
  const steps: RangoSwapStep[] = [];
  const transactions: RangoResolvedTx[] = [];

  for (let i = 0; i < rawSteps.length; i++) {
    const raw = rawSteps[i]!;

    steps.push({
      stepIndex: i,
      swapper: {
        id: raw.swapper.swapperId,
        title: raw.swapper.swapperTitle,
        type: raw.swapper.swapperType,
      },
      from: {
        symbol: raw.from.symbol,
        amount: String(raw.from.realAmount ?? raw.from.expectedAmount ?? ''),
        chain: raw.from.blockchainData.blockchain,
        chainDisplayName: raw.from.blockchainData.displayName ?? raw.from.blockchainData.shortName,
      },
      to: {
        symbol: raw.to.symbol,
        amount: String(raw.to.realAmount ?? raw.to.expectedAmount ?? ''),
        chain: raw.to.blockchainData.blockchain,
        chainDisplayName: raw.to.blockchainData.displayName ?? raw.to.blockchainData.shortName,
      },
      status: raw.status,
      failureReason: undefined,
    });

    // Extract transactions from explorerUrls (most complete source — includes outbound txs)
    const explorerUrls = raw.explorerUrls ?? [];
    const fromChain = raw.from.blockchainData.blockchain;
    const fromChainType = raw.from.blockchainData.type;
    const fromChainDisplay = raw.from.blockchainData.displayName ?? raw.from.blockchainData.shortName;
    const toChain = raw.to.blockchainData.blockchain;
    const toChainType = raw.to.blockchainData.type;
    const toChainDisplay = raw.to.blockchainData.displayName ?? raw.to.blockchainData.shortName;

    if (explorerUrls.length > 0) {
      for (const eu of explorerUrls) {
        const txHash = extractTxHashFromUrl(eu.url);
        if (!txHash) continue;

        // "Outbound" → to chain, everything else → from chain
        const isOutbound = eu.description?.toLowerCase() === 'outbound';
        const chain = isOutbound ? toChain : fromChain;
        const chainType = isOutbound ? toChainType : fromChainType;
        const chainDisplay = isOutbound ? toChainDisplay : fromChainDisplay;
        const networkId = mapChainToNetworkId(chain);

        transactions.push({
          txHash,
          networkId,
          chainName: chain,
          chainDisplayName: chainDisplay,
          chainType: chainType,
          analyzable: networkId !== null,
          stepIndex: i,
          explorerUrl: eu.url,
        });
      }
    } else if (raw.generatedTxId && raw.generatedTxId.length > 0) {
      // Fallback: use generatedTxId if no explorerUrls
      for (const txHash of raw.generatedTxId) {
        const networkId = mapChainToNetworkId(fromChain);
        transactions.push({
          txHash,
          networkId,
          chainName: fromChain,
          chainDisplayName: fromChainDisplay,
          chainType: fromChainType,
          analyzable: networkId !== null,
          stepIndex: i,
          explorerUrl: null,
        });
      }
    }
  }

  // Derive overall status
  const overallStatus = rawSteps.some(s => s.status === 'failed')
    ? 'failed'
    : rawSteps.some(s => s.status === 'running')
      ? 'running'
      : 'success';

  const firstStep = rawSteps[0]!;
  const lastStep = rawSteps[rawSteps.length - 1]!;

  return {
    swapId,
    status: overallStatus,
    fromToken: {
      symbol: firstStep.from.symbol,
      amount: String(firstStep.from.realAmount ?? firstStep.from.expectedAmount ?? ''),
      chain: firstStep.from.blockchainData.displayName ?? firstStep.from.blockchainData.shortName,
    },
    toToken: {
      symbol: lastStep.to.symbol,
      amount: String(lastStep.to.realAmount ?? lastStep.to.expectedAmount ?? ''),
      chain: lastStep.to.blockchainData.displayName ?? lastStep.to.blockchainData.shortName,
    },
    steps,
    transactions,
  };
}
