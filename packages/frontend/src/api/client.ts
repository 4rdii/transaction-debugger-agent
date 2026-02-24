import type { DebugRequest, DebugResponse, QARequest, QAResponse } from '@debugger/shared';

async function apiFetch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
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

export async function askQuestion(req: QARequest): Promise<QAResponse> {
  return apiFetch<QAResponse>('/api/qa', req);
}
