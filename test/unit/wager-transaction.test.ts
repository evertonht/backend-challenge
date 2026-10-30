import { describe, expect, test } from "bun:test";
import { WagerTransaction } from "../../src/domain/wager-transaction";
import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/enums";
import { FailureCode } from "../../src/domain/failure-code";
import { Money } from "../../src/domain/money";
import { InvalidTransactionStateError } from "../../src/domain/errors";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

function base(kind: WagerTransactionKind, extra: Partial<Parameters<typeof WagerTransaction.create>[0]> = {}) {
  return WagerTransaction.create({
    id: "t1",
    providerId: "provider-a",
    externalTransactionId: "tx-1",
    idempotencyKey: "provider-a:tx-1",
    payloadHash: "hash",
    walletId: "w1",
    playerId: "p1",
    roundId: "r1",
    gameId: "g1",
    kind,
    money: brl("25.00"),
    ...extra,
  });
}

describe("WagerTransaction.create", () => {
  test("is born PENDING", () => {
    expect(base(WagerTransactionKind.Bet).status).toBe(WagerTransactionStatus.Pending);
  });

  test("REFUND and ROLLBACK require a reference", () => {
    expect(() => base(WagerTransactionKind.Refund)).toThrow(InvalidTransactionStateError);
    expect(() => base(WagerTransactionKind.Rollback)).toThrow(InvalidTransactionStateError);
  });

  test("OPENING is not submittable", () => {
    expect(() => base(WagerTransactionKind.Opening)).toThrow(InvalidTransactionStateError);
  });
});

describe("WagerTransaction state machine", () => {
  test("PENDING → PROCESSED is terminal", () => {
    const t = base(WagerTransactionKind.Bet);
    t.markProcessed(undefined, undefined, new Date());
    expect(t.status).toBe(WagerTransactionStatus.Processed);
    expect(t.isTerminal()).toBe(true);
    expect(() => t.markProcessed(undefined, undefined, new Date())).toThrow(InvalidTransactionStateError);
    expect(() => t.reject(FailureCode.InvalidPayload)).toThrow(InvalidTransactionStateError);
  });

  test("PENDING → REJECTED is terminal", () => {
    const t = base(WagerTransactionKind.Bet);
    t.reject(FailureCode.InsufficientBalance);
    expect(t.status).toBe(WagerTransactionStatus.Rejected);
    expect(t.failureCode).toBe(FailureCode.InsufficientBalance);
    expect(t.isTerminal()).toBe(true);
    expect(() => t.markProcessed(undefined, undefined, new Date())).toThrow(InvalidTransactionStateError);
  });

  test("PENDING → FAILED is terminal", () => {
    const t = base(WagerTransactionKind.Bet);
    t.fail(FailureCode.WalletNotFound);
    expect(t.status).toBe(WagerTransactionStatus.Failed);
    expect(t.isTerminal()).toBe(true);
  });

  test("PENDING → PENDING_REFERENCE → PROCESSED", () => {
    const t = base(WagerTransactionKind.Refund, { referenceExternalTransactionId: "ref-1" });
    t.markPendingReference(new Date());
    expect(t.status).toBe(WagerTransactionStatus.PendingReference);
    t.markProcessed("ref-internal-id", undefined, new Date());
    expect(t.status).toBe(WagerTransactionStatus.Processed);
    expect(t.referenceTransactionId).toBe("ref-internal-id");
  });

  test("PENDING_REFERENCE → REJECTED on exhaustion", () => {
    const t = base(WagerTransactionKind.Refund, { referenceExternalTransactionId: "ref-1" });
    t.markPendingReference(new Date());
    t.reject(FailureCode.ReferenceNotFound);
    expect(t.status).toBe(WagerTransactionStatus.Rejected);
    expect(t.failureCode).toBe(FailureCode.ReferenceNotFound);
  });
});

describe("WagerTransaction queries", () => {
  test("affectsBalance is false only for LOSS", () => {
    expect(base(WagerTransactionKind.Bet).affectsBalance()).toBe(true);
    expect(base(WagerTransactionKind.Win).affectsBalance()).toBe(true);
    expect(base(WagerTransactionKind.Loss).affectsBalance()).toBe(false);
    expect(base(WagerTransactionKind.Refund, { referenceExternalTransactionId: "r" }).affectsBalance()).toBe(true);
  });

  test("requiresReference only for REFUND/ROLLBACK", () => {
    expect(base(WagerTransactionKind.Bet).requiresReference()).toBe(false);
    expect(base(WagerTransactionKind.Refund, { referenceExternalTransactionId: "r" }).requiresReference()).toBe(true);
    expect(base(WagerTransactionKind.Rollback, { referenceExternalTransactionId: "r" }).requiresReference()).toBe(true);
  });

  test("matchesPayload", () => {
    expect(base(WagerTransactionKind.Bet).matchesPayload("hash")).toBe(true);
    expect(base(WagerTransactionKind.Bet).matchesPayload("other")).toBe(false);
  });

  test("ledgerDirectionFor", () => {
    expect(base(WagerTransactionKind.Bet).ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    expect(base(WagerTransactionKind.Win).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    expect(base(WagerTransactionKind.Refund, { referenceExternalTransactionId: "r" }).ledgerDirectionFor()).toBe(
      LedgerDirection.Credit,
    );
    const bet = base(WagerTransactionKind.Bet);
    const rollback = base(WagerTransactionKind.Rollback, { referenceExternalTransactionId: "tx-1" });
    expect(rollback.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
    expect(() => base(WagerTransactionKind.Loss).ledgerDirectionFor()).toThrow(InvalidTransactionStateError);
  });
});

describe("Pending-reference retry bookkeeping", () => {
  test("markPendingReference schedules the first attempt", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const t = base(WagerTransactionKind.Refund, { referenceExternalTransactionId: "r" });
    t.markPendingReference(now);
    expect(t.attempts).toBe(1);
    expect(t.nextAttemptAt?.getTime()).toBe(now.getTime() + 30_000);
  });

  test("exhaustion by attempts or TTL", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const makeRefund = (attempts: number, createdAtOverride?: Date) =>
      WagerTransaction.rehydrate({
        id: "t2",
        providerId: "provider-a",
        externalTransactionId: "tx-2",
        idempotencyKey: "provider-a:tx-2",
        payloadHash: "hash",
        walletId: "w1",
        playerId: "p1",
        roundId: "r1",
        gameId: "g1",
        kind: WagerTransactionKind.Refund,
        money: brl("25.00").toJSON(),
        referenceExternalTransactionId: "r",
        createdAt: createdAtOverride ?? createdAt,
        status: WagerTransactionStatus.PendingReference,
        attempts,
        nextAttemptAt: new Date("2026-01-01T00:00:30Z"),
      });

    // 8 attempts → exhausted even if recent
    expect(makeRefund(8).hasExhaustedReferenceAttempts(new Date("2026-01-01T00:01:00Z"))).toBe(true);

    // TTL: created > 24h ago → exhausted even with few attempts
    const old = new Date("2025-12-31T00:00:00Z");
    expect(makeRefund(1, old).hasExhaustedReferenceAttempts(new Date("2026-01-01T00:00:01Z"))).toBe(true);

    // Fresh + few attempts → not exhausted
    expect(makeRefund(1).hasExhaustedReferenceAttempts(new Date("2026-01-01T00:01:00Z"))).toBe(false);
  });
});
