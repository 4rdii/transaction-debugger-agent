import type { DebugRequest, DebugResponse, QARequest, QAResponse } from '@debugger/shared';

// In dev, VITE_API_URL is unset so relative paths are used (proxied by Vite to localhost:3001).
// In production (Vercel), set VITE_API_URL=https://your-server.com:3001
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

async function apiFetch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export async function debugTransaction(req: DebugRequest): Promise<DebugResponse> {
  return apiFetch<DebugResponse>('/api/debug', req);
}

export type StreamEvent =
  | { type: 'step'; message: string }
  | { type: 'tool_call'; turn: number; toolNames: string[] }
  | { type: 'tool_result'; turn: number; toolName: string; summary: string }
  | { type: 'complete'; result: DebugResponse['result'] }
  | { type: 'error'; message: string };

/** Opens an SSE connection to /api/debug/stream and calls onEvent for each message.
 *  Returns a cleanup function that closes the connection. */
export function streamDebugTransaction(
  req: DebugRequest,
  onEvent: (event: StreamEvent) => void,
): () => void {
  const url = `${API_BASE}/api/debug/stream?txHash=${encodeURIComponent(req.txHash)}&networkId=${encodeURIComponent(req.networkId)}`;
  const es = new EventSource(url);

  es.onmessage = (e: MessageEvent) => {
    try {
      const event = JSON.parse(e.data as string) as StreamEvent;
      onEvent(event);
      if (event.type === 'complete' || event.type === 'error') {
        es.close();
      }
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    onEvent({ type: 'error', message: 'Connection lost' });
    es.close();
  };

  return () => es.close();
}

export async function askQuestion(req: QARequest): Promise<QAResponse> {
  return apiFetch<QAResponse>('/api/qa', req);
}
