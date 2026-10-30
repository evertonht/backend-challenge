import { FailureCode } from "./failure-code";

/**
 * Base domain error hierarchy. Pure TypeScript — no framework/ORM imports.
 */

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

// ---------------------------------------------------------------------------
// Programming / invariant violations (no FailureCode — a bug, not a business outcome)
// ---------------------------------------------------------------------------

/** A state-machine transition attempted on a terminal transaction (§6.3). */
export class InvalidTransactionStateError extends DomainError {}

/** A malformed money amount/currency (NaN, Infinity, scientific notation, >2dp, negative, …). */
export class InvalidMoneyError extends DomainError {
  constructor(public readonly amount: unknown) {
    super(`Invalid money amount: ${String(amount)}`);
  }
}

// ---------------------------------------------------------------------------
// Business-rule rejections — each carries a stable FailureCode (§7.2)
// ---------------------------------------------------------------------------

export class BusinessRuleError extends DomainError {
  constructor(
    public readonly code: FailureCode,
    message: string,
  ) {
    super(message);
  }
}

/** An operation between two different currencies (§6.1 / §6.2). */
export class CurrencyMismatchError extends BusinessRuleError {
  constructor(
    public readonly left: string,
    public readonly right: string,
  ) {
    super(FailureCode.CurrencyMismatch, `Currency mismatch: ${left} vs ${right}`);
  }
}

export class InsufficientBalanceError extends BusinessRuleError {
  constructor() {
    super(FailureCode.InsufficientBalance, "Insufficient balance for BET");
  }
}

/** A reversal that would drive the wallet balance below zero (§7.9). */
export class ReversalWouldOverdrawError extends BusinessRuleError {
  constructor() {
    super(FailureCode.ReversalWouldOverdraw, "Reversal would overdraw the wallet");
  }
}

export class WalletNotFoundError extends BusinessRuleError {
  constructor(walletId: string) {
    super(FailureCode.WalletNotFound, `Wallet not found: ${walletId}`);
  }
}

export class IdempotencyConflictError extends BusinessRuleError {
  constructor() {
    super(FailureCode.IdempotencyConflict, "Idempotency key reused with a different payload");
  }
}

/** Duplicate wallet for the same (playerId, currency) — mapped to HTTP 409. */
export class DuplicateWalletError extends DomainError {
  constructor(
    public readonly playerId: string,
    public readonly currency: string,
  ) {
    super(`Wallet already exists for ${playerId}/${currency}`);
  }
}

export class InvalidPayloadError extends BusinessRuleError {
  constructor(message = "Invalid payload") {
    super(FailureCode.InvalidPayload, message);
  }
}

// Reference validation (§7.2) — one error per stable code.
export class ReferenceNotFoundError extends BusinessRuleError {
  constructor() {
    super(FailureCode.ReferenceNotFound, "Referenced transaction not found");
  }
}

export class ReferenceAlreadyReversedError extends BusinessRuleError {
  constructor() {
    super(FailureCode.ReferenceAlreadyReversed, "Referenced transaction already reversed");
  }
}

export class ReferenceValueMismatchError extends BusinessRuleError {
  constructor() {
    super(FailureCode.ReferenceValueMismatch, "Reversal value must equal the reference value");
  }
}

export class ReferenceInvalidKindError extends BusinessRuleError {
  constructor() {
    super(FailureCode.ReferenceInvalidKind, "Reversal references an invalid transaction kind");
  }
}

export class ReferenceScopeMismatchError extends BusinessRuleError {
  constructor() {
    super(FailureCode.ReferenceScopeMismatch, "Reference does not match provider/player/wallet/currency/round scope");
  }
}

export class ReferenceNotProcessedError extends BusinessRuleError {
  constructor() {
    super(FailureCode.ReferenceNotProcessed, "Referenced transaction is not PROCESSED");
  }
}
