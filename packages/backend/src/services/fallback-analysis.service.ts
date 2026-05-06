/**
 * Fallback analysis — build a minimal AnalysisResult from on-chain data
 * (tx + receipt + logs) when upstream providers (Tenderly, LLM agent) fail.
 *
 * The goal is "degrade, don't die": instead of returning a 5xx when Tenderly
 * is unavailable, we return what the public RPC does tell us (token transfers,
 * approvals, swap event fingerprints) plus a loud risk flag so the frontend
 * can surface that the simulation layer was skipped.
 */

import { ethers } from 'ethers';
import type {
  AnalysisResult,
  NormalizedCall,
  TokenFlow,
  SemanticAction,
  RiskFlag,
  FailureReason,
} from '@debugger/shared';
import type { RawTxParams } from './ethers.service.js';
import { getRpcUrl } from '../config.js';

/** Well-known event signatures we can decode without ABIs. */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const SWAP_V2_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const SWAP_V3_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
const DEPOSIT_TOPIC = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c';
const WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';

/** Canonical ERC-4337 EntryPoint address (v0.6 + v0.7). */
const ENTRYPOINT_ADDRESSES = new Set([
  '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', // v0.6
  '0x0000000071727de22e5e9d8baf0edac6f37da032', // v0.7
]);
const USEROP_EVENT_TOPIC = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';

function topicToAddress(topic: string): string {
  return ethers.getAddress('0x' + topic.slice(-40));
}

/** Minimal ERC-20 metadata fetcher — uses RPC multicall-style fan-out. */
async function fetchErc20Metadata(
  provider: ethers.JsonRpcProvider,
  tokens: Set<string>,
): Promise<Map<string, { symbol: string; name: string; decimals: number }>> {
  const iface = new ethers.Interface([
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function decimals() view returns (uint8)',
  ]);

  const out = new Map<string, { symbol: string; name: string; decimals: number }>();

  await Promise.all(Array.from(tokens).map(async (addr) => {
    const contract = new ethers.Contract(addr, iface, provider);
    const [symbol, name, decimals] = await Promise.all([
      contract.symbol().catch(() => 'UNKNOWN'),
      contract.name().catch(() => 'Unknown Token'),
      contract.decimals().catch(() => 18n).then((d: bigint | number) => Number(d)),
    ]);
    out.set(addr.toLowerCase(), { symbol, name, decimals });
  }));

  return out;
}

/** Build a synthetic root NormalizedCall representing the top-level transaction. */
function buildSyntheticCallTree(params: RawTxParams): NormalizedCall {
  return {
    id: '0',
    depth: 0,
    callType: 'CALL',
    caller: params.from,
    callee: params.to,
    functionSelector: params.input.length >= 10 ? params.input.slice(0, 10) : undefined,
    decodedInputs: [],
    decodedOutputs: [],
    gasUsed: params.gasUsed,
    valueWei: params.value,
    success: params.onChainStatus,
    revertReason: params.onChainStatus ? undefined : 'Tx reverted on-chain (simulation unavailable — exact reason unknown)',
    children: [],
  };
}

/**
 * Build a fallback AnalysisResult using only RPC receipt logs.
 */
export async function buildFallbackAnalysis(
  txHash: string,
  networkId: string,
  params: RawTxParams,
  reason: string,
): Promise<AnalysisResult> {
  const rpcUrl = getRpcUrl(networkId);
  const provider = new ethers.JsonRpcProvider(rpcUrl, Number(networkId), { staticNetwork: true });
  const receipt = await provider.getTransactionReceipt(txHash);

  const tokenFlows: TokenFlow[] = [];
  const semanticActions: SemanticAction[] = [];
  const riskFlags: RiskFlag[] = [];
  const erc20Addrs = new Set<string>();

  if (receipt) {
    // First pass: gather unique ERC-20 addrs
    for (const log of receipt.logs) {
      if (log.topics.length >= 3 &&
          (log.topics[0] === TRANSFER_TOPIC || log.topics[0] === APPROVAL_TOPIC)) {
        erc20Addrs.add(log.address.toLowerCase());
      }
    }

    let metadata: Map<string, { symbol: string; name: string; decimals: number }>;
    try {
      metadata = await fetchErc20Metadata(provider, erc20Addrs);
    } catch {
      metadata = new Map();
    }

    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      const addr = log.address.toLowerCase();
      const meta = metadata.get(addr) ?? { symbol: 'UNKNOWN', name: 'Unknown Token', decimals: 18 };

      // ERC-20 Transfer
      if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
        const from = topicToAddress(log.topics[1]);
        const to = topicToAddress(log.topics[2]);
        const raw = BigInt(log.data || '0');
        const formatted = ethers.formatUnits(raw, meta.decimals);

        const isMint = from === ethers.ZeroAddress;
        const isBurn = to === ethers.ZeroAddress;

        tokenFlows.push({
          type: isMint ? 'Mint' : isBurn ? 'Burn' : 'Transfer',
          from,
          to,
          tokenAddress: log.address,
          tokenSymbol: meta.symbol,
          tokenName: meta.name,
          decimals: meta.decimals,
          rawAmount: raw.toString(),
          formattedAmount: formatted,
        });

        semanticActions.push({
          type: isMint ? 'Mint' : isBurn ? 'Burn' : 'Transfer',
          callId: `log_${i}`,
          description: `${isMint ? 'Mint' : isBurn ? 'Burn' : 'Transfer'} ${formatted} ${meta.symbol} ${isMint ? 'to' : isBurn ? 'from' : 'from'} ${isMint ? to : from}${isMint || isBurn ? '' : ` to ${to}`}`,
          involvedTokens: [log.address],
          involvedAddresses: [from, to],
        });
      }

      // ERC-20 Approval
      if (log.topics[0] === APPROVAL_TOPIC && log.topics.length >= 3) {
        const owner = topicToAddress(log.topics[1]);
        const spender = topicToAddress(log.topics[2]);
        const raw = BigInt(log.data || '0');
        const formatted = ethers.formatUnits(raw, meta.decimals);

        semanticActions.push({
          type: 'Approve',
          callId: `log_${i}`,
          description: `Approve spender ${spender} for ${formatted} ${meta.symbol}`,
          involvedTokens: [log.address],
          involvedAddresses: [owner, spender],
        });

        // Unlimited approval risk flag
        if (raw === ethers.MaxUint256) {
          riskFlags.push({
            level: 'medium',
            type: 'UNLIMITED_APPROVAL',
            description: `Unlimited ${meta.symbol} approval granted to ${spender}`,
            callId: `log_${i}`,
          });
        }
      }

      // Uniswap V2 Swap fingerprint
      if (log.topics[0] === SWAP_V2_TOPIC) {
        semanticActions.push({
          type: 'Swap',
          protocol: 'Uniswap V2 (or fork)',
          callId: `log_${i}`,
          description: `Swap detected on ${log.address}`,
          involvedTokens: [],
          involvedAddresses: [log.address],
        });
      }

      // Uniswap V3 Swap fingerprint
      if (log.topics[0] === SWAP_V3_TOPIC) {
        semanticActions.push({
          type: 'Swap',
          protocol: 'Uniswap V3 (or fork)',
          callId: `log_${i}`,
          description: `V3-style swap on ${log.address}`,
          involvedTokens: [],
          involvedAddresses: [log.address],
        });
      }

      // WETH-style Deposit/Withdrawal
      if (log.topics[0] === DEPOSIT_TOPIC) {
        semanticActions.push({
          type: 'Deposit',
          callId: `log_${i}`,
          description: `Native deposit (wrap) detected on ${log.address}`,
          involvedTokens: [log.address],
          involvedAddresses: [],
        });
      }
      if (log.topics[0] === WITHDRAWAL_TOPIC) {
        semanticActions.push({
          type: 'Withdraw',
          callId: `log_${i}`,
          description: `Native withdrawal (unwrap) detected on ${log.address}`,
          involvedTokens: [log.address],
          involvedAddresses: [],
        });
      }

      // ERC-4337 UserOperationEvent
      if (ENTRYPOINT_ADDRESSES.has(addr) && log.topics[0] === USEROP_EVENT_TOPIC) {
        const sender = log.topics.length > 2 ? topicToAddress(log.topics[2]) : '';
        const paymaster = log.topics.length > 3 ? topicToAddress(log.topics[3]) : '';
        semanticActions.push({
          type: 'ContractInteraction',
          protocol: 'ERC-4337 Account Abstraction',
          callId: `log_${i}`,
          description: `UserOperation via EntryPoint${sender ? ` (sender: ${sender})` : ''}${paymaster && paymaster !== ethers.ZeroAddress ? `, paymaster: ${paymaster}` : ''}`,
          involvedTokens: [],
          involvedAddresses: [log.address, sender, paymaster].filter(Boolean),
        });
      }
    }
  }

  // Always flag that simulation was skipped
  riskFlags.unshift({
    level: 'low',
    type: 'SIMULATION_UNAVAILABLE',
    description: `Deep simulation (Tenderly) failed or was skipped: ${reason}. Analysis is limited to on-chain receipt data — call tree, revert sources, and storage overrides are unavailable.`,
  });

  // Native ETH value transfer at top level
  if (params.value && params.value !== '0') {
    const eth = ethers.formatEther(params.value);
    tokenFlows.unshift({
      type: 'NativeTransfer',
      from: params.from,
      to: params.to,
      tokenAddress: ethers.ZeroAddress,
      tokenSymbol: 'ETH',
      tokenName: 'Ether',
      decimals: 18,
      rawAmount: params.value,
      formattedAmount: eth,
    });
  }

  let failureReason: FailureReason | undefined;
  if (!params.onChainStatus) {
    failureReason = {
      rootCallId: '0',
      reason: 'Transaction reverted on-chain',
      explanation: 'The transaction was mined but reverted. The exact revert source cannot be determined without a working simulation; consider retrying after Tenderly is available.',
    };
  }

  const addressLabels: Record<string, string> = {};
  for (const [addr, meta] of await (async () => {
    try {
      return await fetchErc20Metadata(provider, erc20Addrs);
    } catch {
      return new Map<string, { symbol: string; name: string; decimals: number }>();
    }
  })()) {
    addressLabels[addr] = `${meta.symbol} Token`;
  }
  if (ENTRYPOINT_ADDRESSES.has((params.to || '').toLowerCase())) {
    addressLabels[params.to] = 'ERC-4337 EntryPoint';
  }

  return {
    txHash,
    networkId,
    success: params.onChainStatus,
    gasUsed: params.gasUsed,
    blockNumber: params.blockNumber,
    callTree: buildSyntheticCallTree(params),
    tokenFlows,
    semanticActions,
    riskFlags,
    failureReason,
    llmExplanation: '',
    addressLabels,
    analyzedAt: new Date().toISOString(),
  };
}
