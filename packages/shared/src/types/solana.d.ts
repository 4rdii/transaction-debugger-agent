export interface SolanaTokenBalance {
    accountIndex: number;
    mint: string;
    owner: string;
    uiTokenAmount: {
        amount: string;
        decimals: number;
        uiAmount: number | null;
        uiAmountString: string;
    };
}
export interface SolanaInnerInstruction {
    index: number;
    instructions: SolanaParsedInstruction[];
}
export interface SolanaParsedInstruction {
    programId: string;
    program?: string;
    parsed?: {
        type: string;
        info: Record<string, unknown>;
    };
    data?: string;
    accounts?: string[];
}
export interface SolanaRawTransaction {
    slot: number;
    blockTime: number | null;
    meta: {
        err: unknown | null;
        fee: number;
        preBalances: number[];
        postBalances: number[];
        preTokenBalances: SolanaTokenBalance[];
        postTokenBalances: SolanaTokenBalance[];
        innerInstructions: SolanaInnerInstruction[];
        logMessages: string[];
        computeUnitsConsumed?: number;
    };
    transaction: {
        message: {
            accountKeys: Array<{
                pubkey: string;
                signer: boolean;
                writable: boolean;
            }>;
            instructions: SolanaParsedInstruction[];
        };
        signatures: string[];
    };
}
export interface HeliusNativeTransfer {
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
}
export interface HeliusTokenTransfer {
    fromUserAccount: string;
    toUserAccount: string;
    fromTokenAccount: string;
    toTokenAccount: string;
    tokenAmount: number;
    mint: string;
    tokenStandard: string;
}
export interface HeliusInstruction {
    programId: string;
    accounts: string[];
    data: string;
    innerInstructions: HeliusInnerInstruction[];
}
export interface HeliusInnerInstruction {
    programId: string;
    accounts: string[];
    data: string;
}
export interface HeliusEnrichedTransaction {
    signature: string;
    description: string;
    type: string;
    source: string;
    fee: number;
    feePayer: string;
    timestamp: number;
    nativeTransfers: HeliusNativeTransfer[];
    tokenTransfers: HeliusTokenTransfer[];
    instructions: HeliusInstruction[];
    events: Record<string, unknown>;
}
export interface SolanaTxData {
    raw: SolanaRawTransaction;
    enriched: HeliusEnrichedTransaction | null;
    signature: string;
    networkId: string;
    success: boolean;
    slot: number;
    fee: number;
    computeUnitsConsumed: number;
    feePayer: string;
    accountKeys: string[];
    logMessages: string[];
}
//# sourceMappingURL=solana.d.ts.map