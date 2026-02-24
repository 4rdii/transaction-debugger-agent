import type { TenderlyCallTrace, NormalizedCall, DecodedParam } from '@debugger/shared';
import { lookupSelector } from '../registry/selectors.js';

let callCounter = 0;

function resetCounter() {
  callCounter = 0;
}

function extractSelector(input: string): string | undefined {
  if (input && input.length >= 10) return input.slice(0, 10).toLowerCase();
  return undefined;
}

function serializeValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function mapDecodedParams(params?: Array<{ name: string; type: string; value?: unknown }>): DecodedParam[] {
  if (!params) return [];
  return params.map(p => ({
    name: p.name,
    type: p.type,
    value: serializeValue(p.value),
  }));
}

function normalizeCall(trace: TenderlyCallTrace, depth: number): NormalizedCall {
  const id = `call-${callCounter++}`;
  const selector = extractSelector(trace.input);
  const selectorInfo = selector ? lookupSelector(selector) : undefined;

  const normalized: NormalizedCall = {
    id,
    depth,
    callType: (trace.type as NormalizedCall['callType']) ?? 'CALL',
    caller: trace.from?.toLowerCase() ?? '',
    callee: trace.to?.toLowerCase() ?? '',
    contractName: trace.contract_name,
    functionName: trace.function_name ?? selectorInfo?.functionSignature,
    functionSelector: selector,
    decodedInputs: mapDecodedParams(trace.decoded_input),
    decodedOutputs: mapDecodedParams(trace.decoded_output),
    gasUsed: trace.gas_used ?? 0,
    valueWei: trace.value ?? '0x0',
    success: !trace.error,
    revertReason: trace.error_reason ?? trace.error,
    protocol: selectorInfo?.protocol,
    action: selectorInfo?.action,
    children: [],
  };

  if (trace.calls && trace.calls.length > 0) {
    normalized.children = trace.calls.map(child => normalizeCall(child, depth + 1));
  }

  return normalized;
}

export function normalizeCallTrace(rootTrace: TenderlyCallTrace): NormalizedCall {
  resetCounter();
  return normalizeCall(rootTrace, 0);
}
