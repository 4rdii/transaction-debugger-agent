// Types for Rango Exchange swap ID resolution

export interface RangoSwapStep {
  stepIndex: number;
  swapper: {
    id: string;
    title: string;
    type: string; // 'DEX' | 'BRIDGE' | etc.
  };
  from: {
    symbol: string;
    amount: string;
    chain: string;
    chainDisplayName: string;
  };
  to: {
    symbol: string;
    amount: string;
    chain: string;
    chainDisplayName: string;
  };
  status: string; // 'success' | 'failed' | 'running'
  failureReason?: string;
}

export interface RangoResolvedTx {
  txHash: string;
  networkId: string | null; // null if chain not supported
  chainName: string;
  chainDisplayName: string;
  chainType: string; // 'EVM' | 'SOLANA' | 'COSMOS' | etc.
  analyzable: boolean;
  stepIndex: number;
  explorerUrl: string | null;
}

export interface RangoSwapOverview {
  swapId: string;
  status: string; // 'success' | 'failed' | 'running'
  fromToken: { symbol: string; amount: string; chain: string };
  toToken: { symbol: string; amount: string; chain: string };
  steps: RangoSwapStep[];
  transactions: RangoResolvedTx[];
}

export interface RangoResolveRequest {
  swapId: string;
}

export interface RangoResolveResponse {
  overview: RangoSwapOverview;
}
