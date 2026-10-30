import { describe, expect, test } from "bun:test";
import { WalletLedgerEntry } from "../../src/domain/ledger-entry";
import { InboxMessage } from "../../src/domain/inbox-message";
import { OutboxMessage, OUTBOX_BASE_DELAY_MS } from "../../src/domain/outbox-message";
import { WalletBalanceChanged, WagerTransactionProcessed, WagerTransactionRejected, WagerTransactionPendingReference } from "../../src/domain/events";
import { LedgerDirection, WagerTransactionKind } from "../../src/domain/enums";
import { FailureCode } from "../../src/domain/failure-code";
import { Money } from "../../src/domain/money";
import { Wallet } from "../../src/domain/wallet";
import { WagerTransaction } from "../../src/domain/wager-transaction";
import { InvalidTransactionStateError } from "../../src/domain/errors";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const ctx = { eventId: "evt-1", correlationId: "corr-1", occurredAt: new Date("2026-01-01T00:00:00Z") };

describe("WalletLedgerEntry", () => {
  test("create validates balanced arithmetic", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "e1",
        walletId: "w1",
        transactionId: "t1",
        direction: LedgerDirection.Credit,
        money: brl("10.00"),
        balanceBefore: brl("0.00"),
        balanceAfter: brl("9.99"), // wrong
      }),
    ).toThrow(InvalidTransactionStateError);
  });

  test("rehydrate does not revalidate arithmetic", () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: "e1",
      walletId: "w1",
      transactionId: "t1",
      direction: LedgerDirection.Credit,
      money: brl("10.00").toJSON(),
      balanceBefore: brl("0.00").toJSON(),
      balanceAfter: brl("9.99").toJSON(), // persisted (hypothetically) unbalanced
      createdAt: new Date(),
    });
    expect(entry.isBalanced()).toBe(false);
  });
});

describe("InboxMessage", () => {
  test("receive → markProcessed", () => {
    const m = InboxMessage.receive({ messageId: "m1", consumerName: "wager", payloadHash: "h" });
    expect(m.isProcessed()).toBe(false);
    const at = new Date();
    m.markProcessed(at);
    expect(m.isProcessed()).toBe(true);
    expect(m.processedAt).toBe(at);
  });
});

describe("OutboxMessage", () => {
  test("isDue / markPublished / scheduleRetry", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const om = OutboxMessage.rehydrate({
      id: "o1",
      aggregateId: "w1",
      eventType: "X",
      payload: {},
      occurredAt: now,
      attempts: 0,
    });
    expect(om.isPending()).toBe(true);
    expect(om.isDue(now)).toBe(true);

    om.scheduleRetry(now);
    expect(om.attempts).toBe(1);
    expect(om.nextAttemptAt?.getTime()).toBe(now.getTime() + OUTBOX_BASE_DELAY_MS);
    expect(om.isDue(now)).toBe(false);
    expect(om.isDue(new Date(now.getTime() + OUTBOX_BASE_DELAY_MS + 1))).toBe(true);

    om.markPublished(new Date());
    expect(om.isPending()).toBe(false);
  });
});

describe("Integration events", () => {
  function tx(kind: WagerTransactionKind) {
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
      referenceExternalTransactionId: kind === WagerTransactionKind.Refund ? "ref-1" : undefined,
    });
  }

  test("WagerTransactionProcessed carries MoneyProps and balance", () => {
    const t = tx(WagerTransactionKind.Bet);
    const e = WagerTransactionProcessed.from(t, brl("975.00"), ctx);
    const json = e.toJSON();
    expect(json.eventType).toBe("WagerTransactionProcessed");
    expect(json.version).toBe(1);
    expect(json.data.money).toEqual({ amount: "25.00", currency: "BRL" });
    expect(json.data.balance).toEqual({ amount: "975.00", currency: "BRL" });
    expect(typeof json.occurredAt).toBe("string");
  });

  test("WagerTransactionProcessed balance is null for LOSS", () => {
    const t = tx(WagerTransactionKind.Loss);
    const e = WagerTransactionProcessed.from(t, null, ctx);
    expect(e.data.balance).toBeNull();
  });

  test("WagerTransactionRejected carries failureCode", () => {
    const t = tx(WagerTransactionKind.Bet);
    t.reject(FailureCode.InsufficientBalance);
    const e = WagerTransactionRejected.from(t, ctx);
    expect(e.data.failureCode).toBe(FailureCode.InsufficientBalance);
  });

  test("WagerTransactionPendingReference carries the missing reference", () => {
    const t = tx(WagerTransactionKind.Refund);
    t.markPendingReference(new Date());
    const e = WagerTransactionPendingReference.from(t, ctx);
    expect(e.data.referenceExternalTransactionId).toBe("ref-1");
  });

  test("WalletBalanceChanged carries ledger + wallet data as MoneyProps", () => {
    const wallet = Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("100.00") });
    const entry = wallet.credit({ entryId: "e1", transactionId: "t1", money: brl("100.00") });
    const e = WalletBalanceChanged.from(wallet, entry, ctx);
    expect(e.data.walletVersion).toBe(2);
    expect(e.data.money).toEqual({ amount: "100.00", currency: "BRL" });
    expect(e.data.balanceAfter).toEqual({ amount: "200.00", currency: "BRL" });
  });

  test("OutboxMessage.enqueue serializes the envelope", () => {
    const wallet = Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("100.00") });
    const entry = wallet.credit({ entryId: "e1", transactionId: "t1", money: brl("100.00") });
    const event = WalletBalanceChanged.from(wallet, entry, ctx);
    const om = OutboxMessage.enqueue(event);
    expect(om.id).toBe("evt-1");
    expect(om.eventType).toBe("WalletBalanceChanged");
    expect(om.aggregateId).toBe("w1");
    expect(om.payload).toHaveProperty("eventType", "WalletBalanceChanged");
  });
});
