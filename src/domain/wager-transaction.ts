import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from "./enums";
import { FailureCode } from "./failure-code";
import { InvalidPayloadError, InvalidTransactionStateError } from "./errors";
import { Money, MoneyProps } from "./money";

/** Pending-reference retry bookkeeping (build-time tuning constants, ticket 10). */
export const PENDING_REFERENCE_BASE_DELAY_MS = 30_000;
export const PENDING_REFERENCE_MAX_DELAY_MS = 10 * 60_000;
export const PENDING_REFERENCE_MAX_ATTEMPTS = 8;
export const PENDING_REFERENCE_TTL_MS = 24 * 60 * 60_000;

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  attempts: number;
  nextAttemptAt?: Date;
  balanceAfter?: MoneyProps;
}

/**
 * The record of a received operation with its state machine
 * `PENDING → PENDING_REFERENCE → PROCESSED | REJECTED | FAILED` (§6.3).
 * `PROCESSED`/`REJECTED`/`FAILED` are terminal and irreversible.
 */
export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _attempts: number = 0,
    private _nextAttemptAt?: Date,
    private _balanceAfter?: Money,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidPayloadError("OPENING is internal and not submittable");
    }
    const tx = new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
    if (tx.requiresReference() && !tx.referenceExternalTransactionId) {
      throw new InvalidPayloadError(`${tx.kind} requires referenceExternalTransactionId`);
    }
    return tx;
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.rehydrate(state.money),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.attempts,
      state.nextAttemptAt,
      state.balanceAfter ? Money.rehydrate(state.balanceAfter) : undefined,
    );
  }

  /**
   * Internal OPENING transaction (§9): the wallet's initial credit. Created and
   * applied atomically with the wallet — it is born PROCESSED, never submittable.
   */
  static opening(props: {
    id: string;
    walletId: string;
    playerId: string;
    money: Money;
    balanceAfter: Money;
    createdAt?: Date;
  }): WagerTransaction {
    const now = props.createdAt ?? new Date();
    const tx = new WagerTransaction(
      props.id,
      "internal",
      `opening:${props.walletId}`,
      `opening:${props.walletId}`,
      "",
      props.walletId,
      props.playerId,
      "",
      "",
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      now,
      WagerTransactionStatus.Processed,
    );
    tx._balanceAfter = props.balanceAfter;
    tx._processedAt = now;
    return tx;
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  /** Post-apply wallet balance observed at processing time (used for idempotent replay). */
  get balanceAfter(): Money | undefined {
    return this._balanceAfter;
  }

  // ---- transitions (throw InvalidTransactionStateError on terminal state) ----
  markProcessed(referenceTransactionId: string | undefined, balanceAfter: Money | undefined, at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._balanceAfter = balanceAfter;
    this._processedAt = at;
  }

  markPendingReference(at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.PendingReference;
    this._attempts = 1;
    this._nextAttemptAt = new Date(at.getTime() + PENDING_REFERENCE_BASE_DELAY_MS);
  }

  /** Advance the retry bookkeeping after a still-unresolved reference. */
  scheduleReferenceRetry(now: Date): void {
    this.assertNotTerminal();
    this._attempts += 1;
    const delay = Math.min(PENDING_REFERENCE_BASE_DELAY_MS * 2 ** (this._attempts - 1), PENDING_REFERENCE_MAX_DELAY_MS);
    this._nextAttemptAt = new Date(now.getTime() + delay);
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  // ---- domain queries ----
  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Opening:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new InvalidTransactionStateError("ROLLBACK requires its reference to determine direction");
        }
        return reference.ledgerDirectionFor() === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
      }
      case WagerTransactionKind.Loss:
        throw new InvalidTransactionStateError("LOSS has no ledger direction");
    }
  }

  // ---- pending-reference retry bookkeeping ----
  isReferenceRetryDue(now: Date): boolean {
    return this._status === WagerTransactionStatus.PendingReference && this._nextAttemptAt !== undefined && this._nextAttemptAt.getTime() <= now.getTime();
  }

  hasExhaustedReferenceAttempts(now: Date): boolean {
    return (
      this._attempts >= PENDING_REFERENCE_MAX_ATTEMPTS ||
      now.getTime() - this.createdAt.getTime() >= PENDING_REFERENCE_TTL_MS
    );
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(`Transaction ${this.id} is terminal (${this._status})`);
    }
  }
}
