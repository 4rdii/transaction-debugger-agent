import type { NormalizedCall, SolanaTxData, SolanaParsedInstruction } from '@debugger/shared';
import { lookupProgramName } from '../registry/solana-programs.js';

// ─── Log parsing helpers ─────────────────────────────────────────────────────

/** Extract instruction name from log line like "Program log: Instruction: Swap" */
function parseInstructionNameFromLogs(logs: string[], programId: string): string | undefined {
  // Look for the Instruction: <name> pattern that appears after the program invoke log
  let foundInvoke = false;
  for (const line of logs) {
    if (line.includes(`Program ${programId} invoke`)) {
      foundInvoke = true;
      continue;
    }
    if (foundInvoke && line.includes('Program log: Instruction: ')) {
      return line.split('Program log: Instruction: ')[1]?.trim();
    }
    // Stop searching if we hit a different program's invoke or a success/fail for our program
    if (foundInvoke && (line.includes(`Program ${programId} success`) || line.includes(`Program ${programId} failed`))) {
      break;
    }
  }
  return undefined;
}

/** Extract error reason from log messages for a specific program */
function parseErrorFromLogs(logs: string[], programId: string): string | undefined {
  for (const line of logs) {
    // Pattern: "Program <addr> failed: <reason>"
    if (line.includes(`Program ${programId} failed:`)) {
      return line.split(`Program ${programId} failed:`)[1]?.trim();
    }
  }
  // Also check for generic error logs
  for (const line of logs) {
    if (line.startsWith('Program log: Error:') || line.startsWith('Program log: AnchorError')) {
      return line.replace('Program log: ', '').trim();
    }
  }
  return undefined;
}

// ─── Normalizer ──────────────────────────────────────────────────────────────

function normalizeInstruction(
  ix: SolanaParsedInstruction,
  depth: number,
  counter: { value: number },
  feePayer: string,
  logs: string[],
  innerInstructionsMap: Map<number, SolanaParsedInstruction[]>,
  ixIndex: number,
): NormalizedCall {
  const id = `call-${counter.value++}`;
  const programId = ix.programId;
  const programName = lookupProgramName(programId);

  // Determine function name from parsed data or logs
  const functionName =
    ix.parsed?.type ??
    parseInstructionNameFromLogs(logs, programId);

  const errorReason = parseErrorFromLogs(logs, programId);

  const node: NormalizedCall = {
    id,
    depth,
    callType: depth === 0 ? 'INVOKE' : 'INVOKE',
    caller: feePayer,
    callee: programId,
    contractName: programName,
    functionName,
    functionSelector: undefined,
    decodedInputs: [],
    decodedOutputs: [],
    gasUsed: 0, // Solana doesn't provide per-instruction CU; set at root
    valueWei: '0',
    success: !errorReason,
    revertReason: errorReason,
    protocol: programName,
    children: [],
  };

  // Add inner instructions (CPIs) as children
  const innerIxs = innerInstructionsMap.get(ixIndex);
  if (innerIxs) {
    node.children = innerIxs.map(innerIx => {
      const childId = `call-${counter.value++}`;
      const innerProgramId = innerIx.programId;
      const innerProgramName = lookupProgramName(innerProgramId);

      return {
        id: childId,
        depth: depth + 1,
        callType: 'CPI' as const,
        caller: programId,
        callee: innerProgramId,
        contractName: innerProgramName,
        functionName: innerIx.parsed?.type,
        functionSelector: undefined,
        decodedInputs: [],
        decodedOutputs: [],
        gasUsed: 0,
        valueWei: '0',
        success: true,
        protocol: innerProgramName,
        children: [],
      };
    });
  }

  return node;
}

export function normalizeSolanaTransaction(txData: SolanaTxData): NormalizedCall {
  const counter = { value: 0 };
  const { raw, feePayer, logMessages } = txData;

  // Build a map from top-level instruction index → inner instructions
  const innerMap = new Map<number, SolanaParsedInstruction[]>();
  for (const inner of raw.meta.innerInstructions) {
    innerMap.set(inner.index, inner.instructions);
  }

  // Root node representing the entire transaction
  const rootId = `call-${counter.value++}`;
  const children = raw.transaction.message.instructions.map((ix, idx) =>
    normalizeInstruction(ix, 1, counter, feePayer, logMessages, innerMap, idx),
  );

  // Extract overall error
  const txError = raw.meta.err
    ? (typeof raw.meta.err === 'string' ? raw.meta.err : JSON.stringify(raw.meta.err))
    : undefined;

  const root: NormalizedCall = {
    id: rootId,
    depth: 0,
    callType: 'INVOKE',
    caller: feePayer,
    callee: feePayer,
    contractName: undefined,
    functionName: 'transaction',
    functionSelector: undefined,
    decodedInputs: [],
    decodedOutputs: [],
    gasUsed: txData.computeUnitsConsumed,
    valueWei: '0',
    success: txData.success,
    revertReason: txError,
    children,
  };

  return root;
}
