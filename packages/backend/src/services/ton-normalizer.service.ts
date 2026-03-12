import type { NormalizedCall, TonTxData, TonTrace, TonRawTransaction } from '@debugger/shared';
import { lookupTonContractName, lookupTonOpCode } from '../registry/ton-contracts.js';

const NANOTON = 1_000_000_000;

function normalizeTraceNode(
  node: TonTrace,
  depth: number,
  counter: { value: number },
  parentAddress: string,
  accountNames: Map<string, string>,
): NormalizedCall {
  const tx = node.transaction;
  const id = `call-${counter.value++}`;

  // Determine function name from op-code or decoded name
  const inMsg = tx.inMsg;
  const opCode = inMsg?.opCode ?? null;
  const opName = inMsg?.decodedOpName ?? lookupTonOpCode(opCode);
  const functionSelector = opCode != null ? `0x${(opCode >>> 0).toString(16).padStart(8, '0')}` : undefined;

  const contractName = lookupTonContractName(tx.account) ?? accountNames.get(tx.account);
  const isBounce = inMsg?.bounced ?? false;
  const callType = isBounce ? 'BOUNCE' as const : 'MESSAGE' as const;

  // Value transferred in this message
  const valueNano = inMsg ? BigInt(inMsg.value) : 0n;
  const valueFormatted = valueNano > 0n
    ? (Number(valueNano) / NANOTON).toFixed(9).replace(/\.?0+$/, '')
    : '0';

  const result: NormalizedCall = {
    id,
    depth,
    callType,
    caller: inMsg?.source ?? parentAddress,
    callee: tx.account,
    contractName,
    functionName: opName,
    functionSelector,
    decodedInputs: [],
    decodedOutputs: [],
    gasUsed: Number(tx.fee),
    valueWei: String(valueNano),
    success: tx.success,
    revertReason: !tx.success ? `exit_code ${tx.exitCode}` : undefined,
    protocol: contractName,
    children: [],
  };

  // Recursively normalize child traces (messages spawned by this transaction)
  result.children = node.children.map((child: TonTrace) =>
    normalizeTraceNode(child, depth + 1, counter, tx.account, accountNames),
  );

  return result;
}

export function normalizeTonTransaction(txData: TonTxData): NormalizedCall {
  const counter = { value: 0 };
  const rootId = `call-${counter.value++}`;
  const rootTx = txData.trace.transaction;
  const accountNames = txData.accountNames;

  // Build children from the trace
  const children = txData.trace.children.map((child: TonTrace) =>
    normalizeTraceNode(child, 1, counter, rootTx.account, accountNames),
  );

  // Also represent outgoing messages from the root tx as children
  // (some won't have trace children if they go to external addresses)
  for (const outMsg of rootTx.outMsgs) {
    // Check if already covered by a child trace
    const alreadyCovered = children.some((c: NormalizedCall) => c.callee === outMsg.destination);
    if (!alreadyCovered && outMsg.destination) {
      const childId = `call-${counter.value++}`;
      const opCode = outMsg.opCode ?? null;
      const opName = outMsg.decodedOpName ?? lookupTonOpCode(opCode);
      const name = lookupTonContractName(outMsg.destination) ?? accountNames.get(outMsg.destination);
      children.push({
        id: childId,
        depth: 1,
        callType: outMsg.bounced ? 'BOUNCE' : 'MESSAGE',
        caller: rootTx.account,
        callee: outMsg.destination,
        contractName: name,
        functionName: opName,
        functionSelector: opCode != null ? `0x${(opCode >>> 0).toString(16).padStart(8, '0')}` : undefined,
        decodedInputs: [],
        decodedOutputs: [],
        gasUsed: 0,
        valueWei: outMsg.value,
        success: true,
        protocol: name,
        children: [],
      });
    }
  }

  const inMsg = rootTx.inMsg;
  const opCode = inMsg?.opCode ?? null;
  const opName = inMsg?.decodedOpName ?? lookupTonOpCode(opCode);

  const root: NormalizedCall = {
    id: rootId,
    depth: 0,
    callType: 'MESSAGE',
    caller: inMsg?.source ?? rootTx.account,
    callee: rootTx.account,
    contractName: lookupTonContractName(rootTx.account) ?? accountNames.get(rootTx.account),
    functionName: opName ?? 'transaction',
    functionSelector: opCode != null ? `0x${(opCode >>> 0).toString(16).padStart(8, '0')}` : undefined,
    decodedInputs: [],
    decodedOutputs: [],
    gasUsed: Number(rootTx.fee),
    valueWei: inMsg?.value ?? '0',
    success: txData.success,
    revertReason: !txData.success ? `exit_code ${txData.exitCode}` : undefined,
    children,
  };

  return root;
}
