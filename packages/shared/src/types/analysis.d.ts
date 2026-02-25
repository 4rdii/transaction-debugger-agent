export type CallType = 'CALL' | 'DELEGATECALL' | 'STATICCALL' | 'CREATE' | 'CREATE2';
export interface DecodedParam {
    name: string;
    type: string;
    value: string;
}
export interface NormalizedCall {
    id: string;
    depth: number;
    callType: CallType;
    caller: string;
    callee: string;
    contractName?: string;
    functionName?: string;
    functionSelector?: string;
    decodedInputs: DecodedParam[];
    decodedOutputs: DecodedParam[];
    gasUsed: number;
    valueWei: string;
    success: boolean;
    revertReason?: string;
    protocol?: string;
    action?: string;
    children: NormalizedCall[];
}
export type TokenFlowType = 'Transfer' | 'Mint' | 'Burn' | 'NativeTransfer';
export interface TokenFlow {
    type: TokenFlowType;
    from: string;
    to: string;
    tokenAddress: string;
    tokenSymbol: string;
    tokenName: string;
    decimals: number;
    rawAmount: string;
    formattedAmount: string;
    dollarValue?: string;
}
export type SemanticActionType = 'Swap' | 'Approve' | 'Bridge' | 'Deposit' | 'Withdraw' | 'Liquidation' | 'Flashloan' | 'Transfer' | 'Multicall' | 'Unknown';
export interface SemanticAction {
    type: SemanticActionType;
    protocol?: string;
    callId: string;
    description: string;
    involvedTokens: string[];
    involvedAddresses: string[];
}
export type RiskLevel = 'low' | 'medium' | 'high';
export interface RiskFlag {
    level: RiskLevel;
    type: string;
    description: string;
    callId?: string;
}
export interface FailureReason {
    rootCallId: string;
    reason: string;
    explanation: string;
}
export interface AnalysisResult {
    txHash: string;
    networkId: string;
    success: boolean;
    gasUsed: number;
    blockNumber: number;
    callTree: NormalizedCall;
    tokenFlows: TokenFlow[];
    semanticActions: SemanticAction[];
    riskFlags: RiskFlag[];
    failureReason?: FailureReason;
    llmExplanation: string;
    analyzedAt: string;
}
//# sourceMappingURL=analysis.d.ts.map