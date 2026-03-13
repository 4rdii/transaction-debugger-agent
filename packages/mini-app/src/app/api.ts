// API client for the debugger backend
// In dev: proxied via Vite to localhost:3001
// In prod: set VITE_API_URL env var to your backend URL

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** Get Telegram WebApp initData for authentication */
function getInitData(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).Telegram?.WebApp?.initData || undefined;
  } catch {
    return undefined;
  }
}

function authHeaders(): Record<string, string> {
  const initData = getInitData();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (initData) headers['X-Telegram-Init-Data'] = initData;
  return headers;
}

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  isPremium?: boolean;
}

/** Check if the current Telegram session is valid */
export async function checkAuth(): Promise<{ ok: boolean; user?: TelegramUser }> {
  const initData = getInitData();
  if (!initData) return { ok: false };

  try {
    const res = await fetch(`${API_BASE}/api/auth/check`, {
      headers: { 'X-Telegram-Init-Data': initData },
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; user?: TelegramUser };
  } catch {
    return { ok: false };
  }
}

export interface TokenFlow {
  type: string;
  from: string;
  to: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  decimals: number;
  rawAmount: string;
  formattedAmount: string;
  dollarValue?: string;
}

export interface RiskFlag {
  level: 'low' | 'medium' | 'high';
  type: string;
  description: string;
  callId?: string;
}

export interface SemanticAction {
  type: string;
  protocol?: string;
  callId: string;
  description: string;
  involvedTokens: string[];
  involvedAddresses: string[];
}

export interface FailureReason {
  rootCallId: string;
  reason: string;
  explanation: string;
}

export interface NormalizedCall {
  id: string;
  depth: number;
  callType: string;
  caller: string;
  callee: string;
  contractName?: string;
  functionName?: string;
  functionSelector?: string;
  gasUsed: number;
  valueWei: string;
  success: boolean;
  revertReason?: string;
  protocol?: string;
  children: NormalizedCall[];
}

export interface AnalysisResult {
  txHash: string;
  networkId: string;
  success: boolean;
  gasUsed: number;
  blockNumber: number;
  callTree: NormalizedCall;
  tokenFlows: TokenFlow[];
  semanticActions: SemanticAction[];
  riskFlags: RiskFlag[];
  failureReason?: FailureReason;
  llmExplanation: string;
  analyzedAt: string;
}

export const NETWORK_LABELS: Record<string, string> = {
  '1': 'Ethereum',
  '137': 'Polygon',
  '42161': 'Arbitrum',
  '10': 'Optimism',
  '8453': 'Base',
  '56': 'BSC',
  'ton-mainnet': 'TON',
  'ton-testnet': 'TON Testnet',
  'solana-mainnet': 'Solana',
  'solana-devnet': 'Solana Devnet',
};

export function networkLabel(networkId: string): string {
  return NETWORK_LABELS[networkId] ?? networkId;
}

export async function askQuestion(
  question: string,
  context?: AnalysisResult,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/qa`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ question, context: context ?? null }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { answer: string };
  return data.answer;
}

export interface SSEEvent {
  type: 'step' | 'tool_call' | 'tool_result' | 'complete' | 'error';
  message?: string;
  result?: AnalysisResult;
  turn?: number;
  toolNames?: string[];
  toolName?: string;
  summary?: string;
}

/**
 * Stream analysis via fetch (not EventSource) so we can send auth headers.
 * Falls back to EventSource for dev without auth.
 */
export function streamAnalysis(
  txHash: string,
  onEvent: (event: SSEEvent) => void,
): () => void {
  const url = `${API_BASE}/api/debug/stream?txHash=${encodeURIComponent(txHash)}`;
  const initData = getInitData();
  const controller = new AbortController();
  let done = false;

  // Use fetch with ReadableStream to send auth header
  (async () => {
    try {
      const headers: Record<string, string> = {};
      if (initData) headers['X-Telegram-Init-Data'] = initData;

      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        onEvent({ type: 'error', message: text || `HTTP ${res.status}` });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onEvent({ type: 'error', message: 'No response body' });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as SSEEvent;
              onEvent(data);
              if (data.type === 'complete' || data.type === 'error') {
                done = true;
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }

      if (!done) {
        onEvent({ type: 'error', message: 'Connection closed' });
      }
    } catch (err) {
      if (!done && !controller.signal.aborted) {
        onEvent({ type: 'error', message: err instanceof Error ? err.message : 'Connection lost' });
      }
    }
  })();

  return () => {
    done = true;
    controller.abort();
  };
}
