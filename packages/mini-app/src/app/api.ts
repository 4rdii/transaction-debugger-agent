// API client for the debugger backend
// In dev: proxied via Vite to localhost:3001
// In prod: set VITE_API_URL env var to your backend URL

const API_BASE = import.meta.env.VITE_API_URL ?? '';

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

export type Chain = 'TON' | 'ETH' | 'Polygon' | 'Arbitrum' | 'Base';

export const CHAIN_TO_NETWORK_ID: Record<Chain, string> = {
  TON: 'ton-mainnet',
  ETH: '1',
  Polygon: '137',
  Arbitrum: '42161',
  Base: '8453',
};

export async function askQuestion(
  question: string,
  context?: AnalysisResult,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export function streamAnalysis(
  txHash: string,
  networkId: string,
  onEvent: (event: SSEEvent) => void,
): () => void {
  const url = `${API_BASE}/api/debug/stream?txHash=${encodeURIComponent(txHash)}&networkId=${encodeURIComponent(networkId)}`;
  const eventSource = new EventSource(url);
  let done = false;

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as SSEEvent;
      onEvent(data);
      if (data.type === 'complete' || data.type === 'error') {
        done = true;
        eventSource.close();
      }
    } catch {
      // ignore parse errors
    }
  };

  eventSource.onerror = () => {
    // EventSource fires onerror when the connection closes after the server
    // finishes sending. Only report as error if we haven't received a
    // complete/error event yet.
    if (!done) {
      onEvent({ type: 'error', message: 'Connection lost' });
    }
    eventSource.close();
  };

  return () => { done = true; eventSource.close(); };
}
