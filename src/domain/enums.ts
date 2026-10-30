export enum WagerTransactionKind {
  Opening = "OPENING", // internal: wallet opening credit, not submittable
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING", // accepted, not yet applied
  PendingReference = "PENDING_REFERENCE", // awaiting the referenced transaction
  Processed = "PROCESSED", // applied (terminal)
  Rejected = "REJECTED", // business-rule violation (terminal)
  Failed = "FAILED", // permanent infra error (terminal, auditable)
}

export enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}
