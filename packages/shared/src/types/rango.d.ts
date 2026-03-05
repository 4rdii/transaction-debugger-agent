export interface RangoSwapStep {
    stepIndex: number;
    swapper: {
        id: string;
        title: string;
        type: string;
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
    status: string;
    failureReason?: string;
}
export interface RangoResolvedTx {
    txHash: string;
    networkId: string | null;
    chainName: string;
    chainDisplayName: string;
    chainType: string;
    analyzable: boolean;
    stepIndex: number;
    explorerUrl: string | null;
}
export interface RangoSwapOverview {
    swapId: string;
    status: string;
    fromToken: {
        symbol: string;
        amount: string;
        chain: string;
    };
    toToken: {
        symbol: string;
        amount: string;
        chain: string;
    };
    steps: RangoSwapStep[];
    transactions: RangoResolvedTx[];
}
export interface RangoResolveRequest {
    swapId: string;
}
export interface RangoResolveResponse {
    overview: RangoSwapOverview;
}
//# sourceMappingURL=rango.d.ts.map