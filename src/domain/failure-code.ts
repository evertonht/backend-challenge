/**
 * Stable, machine-readable rejection codes (§7.2 / ticket 11).
 * Grouped by where the rejection occurs.
 */
export enum FailureCode {
  // Input / transport
  InvalidPayload = "INVALID_PAYLOAD",
  IdempotencyConflict = "IDEMPOTENCY_CONFLICT",
  // Wallet
  WalletNotFound = "WALLET_NOT_FOUND",
  CurrencyMismatch = "CURRENCY_MISMATCH",
  // Balance
  InsufficientBalance = "INSUFFICIENT_BALANCE",
  ReversalWouldOverdraw = "REVERSAL_WOULD_OVERDRAW",
  // Reference
  ReferenceNotFound = "REFERENCE_NOT_FOUND",
  ReferenceAlreadyReversed = "REFERENCE_ALREADY_REVERSED",
  ReferenceValueMismatch = "REFERENCE_VALUE_MISMATCH",
  ReferenceInvalidKind = "REFERENCE_INVALID_KIND",
  ReferenceScopeMismatch = "REFERENCE_SCOPE_MISMATCH",
  ReferenceNotProcessed = "REFERENCE_NOT_PROCESSED",
}
