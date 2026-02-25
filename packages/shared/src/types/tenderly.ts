// Raw Tenderly REST API response shapes
// POST https://api.tenderly.co/api/v1/account/{slug}/project/{slug}/simulate

export interface TenderlySimulateRequest {
  network_id: string;
  block_number?: number | string;
  from: string;
  to: string;
  input: string;
  gas: number;
  gas_price: string;
  value: number;
  save: boolean;
  save_if_fails: boolean;
  simulation_type: 'full' | 'quick' | 'abi';
  generate_access_list?: boolean;
}

export interface TenderlySoltype {
  name: string;
  type: string;
  value?: string;
  components?: TenderlySoltype[];
}

export interface TenderlyCallTrace {
  type: 'CALL' | 'STATICCALL' | 'DELEGATECALL' | 'CREATE' | 'CREATE2';
  from: string;
  to: string;
  input: string;
  output?: string;
  gas: number;
  gas_used: number;
  value?: string;
  error?: string;
  error_reason?: string;
  contract_name?: string;
  function_name?: string;
  decoded_input?: TenderlySoltype[];
  decoded_output?: TenderlySoltype[];
  calls?: TenderlyCallTrace[];
  logs?: TenderlyCallLog[];
  balance_diff?: TenderlyBalanceDiff[];
}

export interface TenderlyCallLog {
  name: string;
  anonymous: boolean;
  inputs: TenderlySoltype[];
  raw: {
    address: string;
    topics: string[];
    data: string;
  };
}

export interface TenderlyBalanceDiff {
  address: string;
  is_miner: boolean;
  original: string;
  dirty: string;
}

export interface TenderlyAssetChange {
  token_info: {
    standard: 'ERC20' | 'ERC721' | 'ERC1155' | 'NATIVE';
    type: 'Fungible' | 'NFT';
    contract_address: string;
    symbol: string;
    name: string;
    logo?: string;
    decimals: number;
    dollar_value?: string;
  };
  type: 'Transfer' | 'Mint' | 'Burn';
  from: string;
  to: string;
  amount: string;
  raw_amount: string;
  dollar_value?: string;
}

export interface TenderlyStateDiff {
  address: string;
  soltype?: TenderlySoltype;
  original: string;
  dirty: string;
}

export interface TenderlyStackFrame {
  contract: string;
  contract_name?: string;
  name: string;
  line: number;
  file_index?: number;
  code?: string;
  error?: string;
  error_reason?: string;
}

export interface TenderlyTransactionInfo {
  call_trace: TenderlyCallTrace;
  asset_changes?: TenderlyAssetChange[];
  state_diff?: TenderlyStateDiff[];
  logs?: TenderlyCallLog[];
  balance_diff?: TenderlyBalanceDiff[];
  stack_trace?: TenderlyStackFrame[];
}

export interface TenderlyTransaction {
  hash: string;
  status: boolean;
  gas_used: number;
  block_number: number;
  network_id: string;
  error_info?: {
    address: string;
    error_message: string;
  };
  transaction_info: TenderlyTransactionInfo;
}

export interface TenderlySimulateResponse {
  transaction: TenderlyTransaction;
  simulation: {
    id: string;
    project_id: string;
    status: boolean;
    created_at: string;
  };
  error?: {
    slug: string;
    message: string;
  };
}
