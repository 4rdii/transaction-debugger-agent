import type { TenderlyCallTrace, NormalizedCall, DecodedParam } from '@debugger/shared';
import { lookupSelector } from '../registry/selectors.js';

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

/** Extract the 4-byte custom error selector from raw revert data.
 *  Returns undefined if the data is too short or looks like a standard Error/Panic ABI encoding. */
function extractCustomErrorSelector(output: string): string | undefined {
  // Must be at least 0x + 8 hex chars (4 bytes)
  if (!output || output.length < 10) return undefined;
  const selector = output.slice(0, 10).toLowerCase();
  // Skip known ABI-encoded selectors: Error(string) = 0x08c379a0, Panic(uint) = 0x4e487b71
  if (selector === '0x08c379a0' || selector === '0x4e487b71') return undefined;
  // Only return if looks like a real 4-byte selector (non-zero)
  if (selector === '0x00000000') return undefined;
  return selector;
}

function normalizeCall(trace: TenderlyCallTrace, depth: number, counter: { value: number }): NormalizedCall {
  const id = `call-${counter.value++}`;
  const selector = extractSelector(trace.input);
  const selectorInfo = selector ? lookupSelector(selector) : undefined;

  const failed = !!trace.error;
  const rawOutput = failed && trace.output && trace.output !== '0x' ? trace.output : undefined;
  const customErrorSelector = rawOutput ? extractCustomErrorSelector(rawOutput) : undefined;

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
    success: !failed,
    revertReason: trace.error_reason ?? trace.error,
    rawRevertData: rawOutput,
    customErrorSelector,
    callInput: failed && trace.input && trace.input !== '0x' ? trace.input : undefined,
    protocol: selectorInfo?.protocol,
    action: selectorInfo?.action,
    children: [],
  };

  if (trace.calls && trace.calls.length > 0) {
    normalized.children = trace.calls.map(child => normalizeCall(child, depth + 1, counter));
  }

  return normalized;
}

export function normalizeCallTrace(rootTrace: TenderlyCallTrace): NormalizedCall {
  const counter = { value: 0 };
  return normalizeCall(rootTrace, 0, counter);
}
