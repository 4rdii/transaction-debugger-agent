// Known custom error codes for popular Solana programs.
// Anchor programs use error codes starting at 6000 (6000 + enum index).
// These serve as a fast fallback when on-chain IDL fetch is unavailable.

export interface ProgramError {
  name: string;
  message: string;
}

type ErrorMap = Record<number, ProgramError>;

// ─── Jupiter V6 ──────────────────────────────────────────────────────────────

const JUPITER_V6_ERRORS: ErrorMap = {
  6000: { name: 'EmptyRoute', message: 'Empty route provided' },
  6001: { name: 'SlippageToleranceExceeded', message: 'Slippage tolerance exceeded — output amount is below the minimum specified' },
  6002: { name: 'InvalidCalculation', message: 'Invalid calculation during swap' },
  6003: { name: 'MissingPlatformFeeAccount', message: 'Missing platform fee account' },
  6004: { name: 'InvalidSlippage', message: 'Invalid slippage value' },
  6005: { name: 'NotEnoughPercent', message: 'Not enough percent for split' },
  6006: { name: 'InvalidInputIndex', message: 'Invalid input index' },
  6007: { name: 'InvalidOutputIndex', message: 'Invalid output index' },
  6008: { name: 'NotEnoughAccountKeys', message: 'Not enough account keys provided' },
  6009: { name: 'NonZeroMinimumOutAmountNotSupported', message: 'Non-zero minimum out amount not supported for this swap' },
  6010: { name: 'InvalidRoutePlan', message: 'Invalid route plan' },
  6011: { name: 'InvalidReferralAuthority', message: 'Invalid referral authority' },
  6012: { name: 'LedgerTokenAccountDoesNotMatch', message: 'Ledger token account does not match' },
  6013: { name: 'InvalidTokenLedger', message: 'Invalid token ledger' },
  6014: { name: 'IncorrectTokenProgramID', message: 'Incorrect token program ID' },
  6015: { name: 'TokenProgramNotProvided', message: 'Token program not provided' },
  6016: { name: 'SwapNotSupported', message: 'Swap not supported' },
  6017: { name: 'ExactOutAmountNotMatched', message: 'Exact out amount not matched' },
};

// ─── Raydium AMM V4 ─────────────────────────────────────────────────────────

const RAYDIUM_AMM_ERRORS: ErrorMap = {
  6000: { name: 'AlreadyInUse', message: 'Already in use' },
  6001: { name: 'InvalidProgramAddress', message: 'Invalid program address' },
  6002: { name: 'ExpectedMint', message: 'Expected a token mint' },
  6003: { name: 'ExpectedAccount', message: 'Expected an account' },
  6004: { name: 'InvalidCoinVault', message: 'Invalid coin vault' },
  6005: { name: 'InvalidPcVault', message: 'Invalid PC vault' },
  6006: { name: 'InvalidTokenMint', message: 'Invalid token mint' },
  6007: { name: 'InvalidOwner', message: 'Invalid owner' },
  6008: { name: 'InvalidSupply', message: 'Invalid supply' },
  6009: { name: 'InvalidDelegate', message: 'Invalid delegate' },
  6010: { name: 'InvalidSignAccount', message: 'Invalid sign account' },
  6011: { name: 'InvalidStatus', message: 'Invalid pool status' },
  6012: { name: 'InvalidInstruction', message: 'Invalid instruction' },
  6013: { name: 'WrongAccountsNumber', message: 'Wrong number of accounts' },
  6014: { name: 'WithdrawTransferBusy', message: 'Withdraw transfer busy' },
  6015: { name: 'WithdrawQueueFull', message: 'Withdraw queue is full' },
  6016: { name: 'ExceededSlippage', message: 'Swap exceeded slippage tolerance' },
};

// ─── Raydium CLMM (Concentrated Liquidity) ──────────────────────────────────

const RAYDIUM_CLMM_ERRORS: ErrorMap = {
  6000: { name: 'LOK', message: 'LOK — pool is locked' },
  6001: { name: 'NotApproved', message: 'Operation not approved' },
  6002: { name: 'InvalidUpdateConfigFlag', message: 'Invalid update config flag' },
  6003: { name: 'AccountLack', message: 'Account missing' },
  6004: { name: 'ClosePositionErr', message: 'Error closing position' },
  6005: { name: 'ZeroMintAmount', message: 'Zero mint amount — must provide liquidity' },
  6006: { name: 'InvaildTickIndex', message: 'Invalid tick index' },
  6007: { name: 'TickInvaildOrder', message: 'Tick invalid order' },
  6008: { name: 'TickLowerOverflow', message: 'Tick lower overflow' },
  6009: { name: 'TickUpperOverflow', message: 'Tick upper overflow' },
  6010: { name: 'TickAndSpacingNotMatch', message: 'Tick and spacing do not match' },
  6011: { name: 'InvalidTickArray', message: 'Invalid tick array' },
  6012: { name: 'InvalidTickArrayBoundary', message: 'Invalid tick array boundary' },
  6013: { name: 'SqrtPriceLimitOverflow', message: 'Sqrt price limit overflow' },
  6014: { name: 'SqrtPriceX64', message: 'Invalid sqrt price X64' },
  6015: { name: 'LiquiditySubValueErr', message: 'Liquidity subtraction error' },
  6016: { name: 'LiquidityAddValueErr', message: 'Liquidity addition error' },
  6017: { name: 'InsufficientLiquidity', message: 'Insufficient liquidity in pool' },
  6020: { name: 'TransactionTooOld', message: 'Transaction too old' },
  6021: { name: 'PriceSlippageCheck', message: 'Price slippage check failed' },
  6022: { name: 'TooLittleOutputReceived', message: 'Too little output received — slippage exceeded' },
  6023: { name: 'TooMuchInputPaid', message: 'Too much input paid — slippage exceeded' },
};

// ─── Orca Whirlpool ──────────────────────────────────────────────────────────

const ORCA_WHIRLPOOL_ERRORS: ErrorMap = {
  6000: { name: 'InvalidEnum', message: 'Invalid enum value' },
  6001: { name: 'InvalidStartTick', message: 'Invalid start tick' },
  6002: { name: 'TickArrayExistInPool', message: 'Tick array already exists in pool' },
  6003: { name: 'TickArrayIndexOutofBounds', message: 'Tick array index out of bounds' },
  6004: { name: 'InvalidTickSpacing', message: 'Invalid tick spacing' },
  6005: { name: 'ClosePositionNotEmpty', message: 'Cannot close position — not empty' },
  6006: { name: 'DivideByZero', message: 'Division by zero' },
  6007: { name: 'NumberCastError', message: 'Number cast error' },
  6008: { name: 'NumberDownCastError', message: 'Number downcast error' },
  6009: { name: 'TickNotFound', message: 'Tick not found' },
  6010: { name: 'InvalidTickIndex', message: 'Invalid tick index — not within range' },
  6011: { name: 'SqrtPriceOutOfBounds', message: 'Sqrt price out of bounds' },
  6012: { name: 'LiquidityZero', message: 'Liquidity is zero' },
  6013: { name: 'LiquidityTooHigh', message: 'Liquidity too high' },
  6014: { name: 'LiquidityOverflow', message: 'Liquidity overflow' },
  6015: { name: 'LiquidityUnderflow', message: 'Liquidity underflow' },
  6016: { name: 'LiquidityNetError', message: 'Liquidity net error' },
  6017: { name: 'TokenMaxExceeded', message: 'Token max exceeded' },
  6018: { name: 'TokenMinSubceeded', message: 'Token min subceeded — slippage tolerance exceeded' },
  6019: { name: 'MissingOrInvalidDelegate', message: 'Missing or invalid delegate' },
  6020: { name: 'InvalidPositionTokenAmount', message: 'Invalid position token amount' },
  6021: { name: 'InvalidTimestampConversion', message: 'Invalid timestamp conversion' },
  6022: { name: 'InvalidTimestamp', message: 'Invalid timestamp' },
  6023: { name: 'InvalidTickArraySequence', message: 'Invalid tick array sequence' },
  6024: { name: 'InvalidTokenMintOrder', message: 'Invalid token mint order' },
  6025: { name: 'RewardNotInitialized', message: 'Reward not initialized' },
  6026: { name: 'InvalidRewardIndex', message: 'Invalid reward index' },
  6027: { name: 'AmountCalcOverflow', message: 'Amount calculation overflow' },
  6028: { name: 'AmountRemainingOverflow', message: 'Amount remaining overflow' },
  6029: { name: 'InvalidIntermediaryMint', message: 'Invalid intermediary mint' },
  6030: { name: 'DuplicateTwoHopPool', message: 'Duplicate two-hop pool' },
};

// ─── SPL Token program built-in errors (not Anchor, but commonly encountered) ─

const SPL_TOKEN_ERRORS: ErrorMap = {
  0: { name: 'NotRentExempt', message: 'Account is not rent exempt' },
  1: { name: 'InsufficientFunds', message: 'Insufficient funds for the operation' },
  2: { name: 'InvalidMint', message: 'Invalid mint' },
  3: { name: 'MintMismatch', message: 'Mint mismatch — account mint does not match expected mint' },
  4: { name: 'OwnerMismatch', message: 'Owner mismatch — account owner does not match expected owner' },
  5: { name: 'FixedSupply', message: 'Token has a fixed supply — cannot mint more' },
  6: { name: 'AlreadyInUse', message: 'Account is already in use' },
  7: { name: 'InvalidNumberOfProvidedSigners', message: 'Invalid number of provided signers' },
  8: { name: 'InvalidNumberOfRequiredSigners', message: 'Invalid number of required signers' },
  9: { name: 'UninitializedState', message: 'Account is uninitialized' },
  10: { name: 'NativeNotSupported', message: 'Operation not supported for native SOL' },
  11: { name: 'NonNativeHasBalance', message: 'Non-native account has balance' },
  12: { name: 'InvalidInstruction', message: 'Invalid instruction' },
  13: { name: 'InvalidState', message: 'Invalid account state' },
  14: { name: 'Overflow', message: 'Arithmetic overflow' },
  15: { name: 'AuthorityTypeNotSupported', message: 'Authority type not supported' },
  16: { name: 'MintCannotFreeze', message: 'Mint cannot freeze' },
  17: { name: 'AccountFrozen', message: 'Account is frozen' },
  18: { name: 'MintDecimalsMismatch', message: 'Mint decimals mismatch' },
  19: { name: 'NonNativeNotSupported', message: 'Non-native not supported' },
};

// ─── System program errors ───────────────────────────────────────────────────

const SYSTEM_PROGRAM_ERRORS: ErrorMap = {
  0: { name: 'AccountAlreadyInUse', message: 'Account is already in use — an account at this address already exists' },
  1: { name: 'ResultWithNegativeLamports', message: 'Result would leave account with negative lamports' },
  2: { name: 'InvalidProgramId', message: 'Invalid program ID' },
  3: { name: 'InvalidAccountDataLength', message: 'Invalid account data length' },
  4: { name: 'MaxSeedLengthExceeded', message: 'Max seed length exceeded' },
  5: { name: 'AddressWithSeedMismatch', message: 'Address with seed mismatch' },
  6: { name: 'NonceNoRecentBlockhashes', message: 'Advance nonce — no recent blockhashes' },
  7: { name: 'NonceBlockhashNotExpired', message: 'Advance nonce — blockhash not expired' },
  8: { name: 'NonceUnexpectedBlockhashValue', message: 'Advance nonce — unexpected blockhash value' },
};

// ─── Registry ────────────────────────────────────────────────────────────────

const PROGRAM_ERRORS: Record<string, ErrorMap> = {
  // Jupiter
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': JUPITER_V6_ERRORS,
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB': JUPITER_V6_ERRORS, // V4 uses similar codes

  // Raydium
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': RAYDIUM_AMM_ERRORS,
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': RAYDIUM_CLMM_ERRORS,

  // Orca
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': ORCA_WHIRLPOOL_ERRORS,

  // SPL Token
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': SPL_TOKEN_ERRORS,
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': SPL_TOKEN_ERRORS, // Token 2022

  // System
  '11111111111111111111111111111111': SYSTEM_PROGRAM_ERRORS,
};

/**
 * Look up a custom error code for a known Solana program.
 * Returns the error info, or undefined if the program or code is unknown.
 */
export function lookupKnownError(programId: string, errorCode: number): ProgramError | undefined {
  return PROGRAM_ERRORS[programId]?.[errorCode];
}

/**
 * Check if we have a known error registry for a given program.
 */
export function hasKnownErrors(programId: string): boolean {
  return programId in PROGRAM_ERRORS;
}
