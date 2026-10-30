import { describe, expect, test } from "bun:test";
import { SubmitTransaction, SubmitTransactionCommand } from "../../src/application/use-cases/submit-transaction";
import { OpenWallet } from "../../src/application/use-cases/open-wallet";
import { WalletRepository } from "../../src/application/ports/wallet-repository";
import { WagerTransactionRepository } from "../../src/application/ports/wager-transaction-repository";
import { LedgerEntryRepository, LedgerPage } from "../../src/application/ports/ledger-entry-repository";
import { OutboxWriter } from "../../src/application/ports/outbox-writer";
import { InboxRepository } from "../../src/application/ports/inbox-repository";
import { IdGenerator } from "../../src/application/ports/id-generator";
import { Clock } from "../../src/application/ports/clock";
import { UnitOfWork } from "../../src/application/ports/unit-of-work";
import { Wallet } from "../../src/domain/wallet";
import { WagerTransaction } from "../../src/domain/wager-transaction";
import { WalletLedgerEntry } from "../../src/domain/ledger-entry";
import { InboxMessage } from "../../src/domain/inbox-message";
import { IntegrationEvent } from "../../src/domain/events";
import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/enums";
import { FailureCode } from "../../src/domain/failure-code";
import { Money } from "../../src/domain/money";
import { Metrics } from "../../src/observability/metrics";
import { Logger } from "../../src/observability/logger";
import { computePayloadHash, canonicalJson } from "../../src/application/idempotency";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

// ---- fakes ----
class FakeIdGenerator extends IdGenerator {
  private n = 0;
  nextId(): string {
    return `id-${++this.n}`;
  }
}
class FakeClock extends Clock {
  constructor(private readonly at: Date = new Date("2026-01-01T00:00:00Z")) {
    super();
  }
  now(): Date {
    return this.at;
  }
}
class FakeUnitOfWork extends UnitOfWork {
  async transactional<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
class FakeWalletRepository extends WalletRepository {
  private readonly map = new Map<string, Wallet>();
  async findById(id: string) {
    return this.map.get(id) ?? null;
  }
  async findForUpdate(id: string) {
    return this.map.get(id) ?? null;
  }
  async findByPlayerCurrency(playerId: string, currency: string) {
    for (const w of this.map.values()) {
      if (w.playerId === playerId && w.currency === currency) return w;
    }
    return null;
  }
  async save(wallet: Wallet) {
    this.map.set(wallet.id, wallet);
  }
}
class FakeTransactionRepository extends WagerTransactionRepository {
  readonly all = new Map<string, WagerTransaction>();
  async findById(id: string) {
    return this.all.get(id) ?? null;
  }
  async findByIdempotencyKey(key: string) {
    for (const t of this.all.values()) if (t.idempotencyKey === key) return t;
    return null;
  }
  async findByProviderExternal(providerId: string, externalTransactionId: string) {
    for (const t of this.all.values()) {
      if (t.providerId === providerId && t.externalTransactionId === externalTransactionId) return t;
    }
    return null;
  }
  async save(tx: WagerTransaction) {
    this.all.set(tx.id, tx);
  }
  async findDuePendingReferences(_now: Date, _limit: number) {
    return [...this.all.values()].filter(
      (t) => t.status === WagerTransactionStatus.PendingReference && t.isReferenceRetryDue(_now),
    );
  }
  async findProcessedReversal(providerId: string, referenceExternalTransactionId: string) {
    for (const t of this.all.values()) {
      if (
        t.providerId === providerId &&
        t.referenceExternalTransactionId === referenceExternalTransactionId &&
        (t.kind === WagerTransactionKind.Refund || t.kind === WagerTransactionKind.Rollback) &&
        t.status === WagerTransactionStatus.Processed
      ) {
        return t;
      }
    }
    return null;
  }
}
class FakeLedgerRepository extends LedgerEntryRepository {
  readonly entries: WalletLedgerEntry[] = [];
  async append(entry: WalletLedgerEntry) {
    this.entries.push(entry);
  }
  async page(walletId: string, _cursor: string | undefined, limit: number): Promise<LedgerPage> {
    const es = this.entries.filter((e) => e.walletId === walletId).slice(0, limit);
    return { entries: es, nextCursor: null };
  }
  async sum(walletId: string, currency: string) {
    let total = Money.zero(currency);
    for (const e of this.entries) {
      if (e.walletId !== walletId) continue;
      total = e.direction === LedgerDirection.Credit ? total.add(e.money) : total.subtract(e.money);
    }
    return total;
  }
  async count(walletId: string) {
    return this.entries.filter((e) => e.walletId === walletId).length;
  }
}
class FakeOutbox extends OutboxWriter {
  readonly events: IntegrationEvent<unknown>[] = [];
  async enqueue(event: IntegrationEvent<unknown>) {
    this.events.push(event);
  }
}
class FakeInbox extends InboxRepository {
  private readonly seen = new Set<string>();
  async record(message: InboxMessage) {
    this.seen.add(`${message.consumerName}:${message.messageId}`);
  }
  async exists(consumerName: string, messageId: string) {
    return this.seen.has(`${consumerName}:${messageId}`);
  }
}

function build() {
  const wallets = new FakeWalletRepository();
  const transactions = new FakeTransactionRepository();
  const ledger = new FakeLedgerRepository();
  const outbox = new FakeOutbox();
  const inbox = new FakeInbox();
  const ids = new FakeIdGenerator();
  const clock = new FakeClock();
  const uow = new FakeUnitOfWork();
  const metrics = new Metrics();
  const logger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, log: () => {} } as unknown as Logger;
  const submit = new SubmitTransaction(uow, wallets, transactions, ledger, outbox, inbox, ids, clock, metrics, logger);
  const openWallet = new OpenWallet(uow, wallets, transactions, ledger, ids, clock);
  return { wallets, transactions, ledger, outbox, inbox, ids, clock, metrics, submit, openWallet };
}

function cmd(overrides: Partial<SubmitTransactionCommand> = {}): SubmitTransactionCommand {
  const base: SubmitTransactionCommand = {
    idempotencyKey: "provider-a:tx-1",
    payloadHash: "",
    providerId: "provider-a",
    externalTransactionId: "tx-1",
    playerId: "p1",
    walletId: "id-1",
    roundId: "r1",
    gameId: "g1",
    kind: WagerTransactionKind.Bet,
    money: brl("25.00"),
    correlationId: "corr-1",
  };
  const merged = { ...base, ...overrides };
  const subset = {
    providerId: merged.providerId,
    externalTransactionId: merged.externalTransactionId,
    playerId: merged.playerId,
    walletId: merged.walletId,
    roundId: merged.roundId,
    gameId: merged.gameId,
    kind: merged.kind,
    money: merged.money.toJSON(),
    ...(merged.referenceExternalTransactionId !== undefined
      ? { referenceExternalTransactionId: merged.referenceExternalTransactionId }
      : {}),
  };
  return { ...merged, payloadHash: computePayloadHash(subset) };
}

async function openWallet(f: ReturnType<typeof build>, amount = "100.00") {
  return f.openWallet.execute({ playerId: "p1", initialBalance: brl(amount) });
}

// ---------------------------------------------------------------------------
describe("idempotency hash", () => {
  test("canonical JSON sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  test("payload hash is stable across key ordering", () => {
    const h1 = computePayloadHash({
      providerId: "a",
      externalTransactionId: "b",
      playerId: "c",
      walletId: "d",
      roundId: "e",
      gameId: "f",
      kind: WagerTransactionKind.Bet,
      money: { amount: "1.00", currency: "BRL" },
    });
    const h2 = computePayloadHash({
      kind: WagerTransactionKind.Bet,
      gameId: "f",
      money: { currency: "BRL", amount: "1.00" },
      providerId: "a",
      externalTransactionId: "b",
      playerId: "c",
      walletId: "d",
      roundId: "e",
    });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
  test("referenceExternalTransactionId changes the hash", () => {
    const h1 = computePayloadHash({
      providerId: "a",
      externalTransactionId: "b",
      playerId: "c",
      walletId: "d",
      roundId: "e",
      gameId: "f",
      kind: WagerTransactionKind.Bet,
      money: { amount: "1.00", currency: "BRL" },
    });
    const h2 = computePayloadHash({
      providerId: "a",
      externalTransactionId: "b",
      playerId: "c",
      walletId: "d",
      roundId: "e",
      gameId: "f",
      kind: WagerTransactionKind.Bet,
      money: { amount: "1.00", currency: "BRL" },
      referenceExternalTransactionId: "x",
    });
    expect(h1).not.toBe(h2);
  });
});

describe("SubmitTransaction", () => {
  test("BET debits and returns PROCESSED with balance", async () => {
    const f = build();
    await openWallet(f, "100.00");
    const r = await f.submit.execute(cmd());
    expect(r.status).toBe(WagerTransactionStatus.Processed);
    expect(r.balance).toEqual({ amount: "75.00", currency: "BRL" });
    expect(r.idempotentReplay).toBe(false);
    expect(f.ledger.entries).toHaveLength(2); // opening + bet
    expect(f.outbox.events.map((e) => e.eventType)).toContain("WagerTransactionProcessed");
    expect(f.outbox.events.map((e) => e.eventType)).toContain("WalletBalanceChanged");
  });

  test("BET with insufficient balance is REJECTED with INSUFFICIENT_BALANCE", async () => {
    const f = build();
    await openWallet(f, "10.00");
    const r = await f.submit.execute(cmd({ money: brl("80.00") }));
    expect(r.status).toBe(WagerTransactionStatus.Rejected);
    expect(r.failureCode).toBe(FailureCode.InsufficientBalance);
    expect(f.outbox.events.map((e) => e.eventType)).toContain("WagerTransactionRejected");
  });

  test("WIN credits", async () => {
    const f = build();
    await openWallet(f, "100.00");
    const r = await f.submit.execute(cmd({ kind: WagerTransactionKind.Win }));
    expect(r.status).toBe(WagerTransactionStatus.Processed);
    expect(r.balance).toEqual({ amount: "125.00", currency: "BRL" });
  });

  test("LOSS records without moving balance or ledger", async () => {
    const f = build();
    await openWallet(f, "100.00");
    const r = await f.submit.execute(cmd({ kind: WagerTransactionKind.Loss }));
    expect(r.status).toBe(WagerTransactionStatus.Processed);
    expect(r.balance).toEqual({ amount: "100.00", currency: "BRL" });
    expect(f.ledger.entries).toHaveLength(1); // only opening
    expect(f.outbox.events.map((e) => e.eventType)).toContain("WagerTransactionProcessed");
    expect(f.outbox.events.map((e) => e.eventType)).not.toContain("WalletBalanceChanged");
  });

  test("currency mismatch is REJECTED with CURRENCY_MISMATCH", async () => {
    const f = build();
    await openWallet(f, "100.00");
    const r = await f.submit.execute(cmd({ money: Money.from({ amount: "25.00", currency: "USD" }) }));
    expect(r.status).toBe(WagerTransactionStatus.Rejected);
    expect(r.failureCode).toBe(FailureCode.CurrencyMismatch);
  });

  test("wallet not found throws WALLET_NOT_FOUND", async () => {
    const f = build();
    const r = await f.submit.execute(cmd()).catch((e) => e);
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).name).toBe("WalletNotFoundError");
  });

  test("idempotent replay returns original result", async () => {
    const f = build();
    await openWallet(f, "100.00");
    const c = cmd();
    const first = await f.submit.execute(c);
    const second = await f.submit.execute(c);
    expect(second.idempotentReplay).toBe(true);
    expect(second.status).toBe(WagerTransactionStatus.Processed);
    expect(second.balance).toEqual(first.balance);
    // no extra ledger entries from the replay
    expect(f.ledger.entries).toHaveLength(2);
  });

  test("idempotency conflict on same key, different payload", async () => {
    const f = build();
    await openWallet(f, "100.00");
    await f.submit.execute(cmd());
    const r = await f.submit.execute(cmd({ money: brl("50.00") })).catch((e) => e);
    expect(r).toBeInstanceOf(Error);
    expect((r as Error).name).toBe("IdempotencyConflictError");
  });
});

describe("SubmitTransaction — reversals", () => {
  async function seedBet(f: ReturnType<typeof build>, amount = "25.00") {
    await openWallet(f, "100.00");
    const c = cmd({ money: brl(amount) });
    await f.submit.execute(c);
    return c.externalTransactionId;
  }

  test("REFUND credits back a processed BET", async () => {
    const f = build();
    const extId = await seedBet(f);
    const r = await f.submit.execute(
      cmd({
        externalTransactionId: "refund-1",
        idempotencyKey: "provider-a:refund-1",
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: extId,
      }),
    );
    expect(r.status).toBe(WagerTransactionStatus.Processed);
    expect(r.balance).toEqual({ amount: "100.00", currency: "BRL" });
  });

  test("REFUND of a missing reference is PENDING_REFERENCE", async () => {
    const f = build();
    await openWallet(f, "100.00");
    const r = await f.submit.execute(
      cmd({
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "does-not-exist",
      }),
    );
    expect(r.status).toBe(WagerTransactionStatus.PendingReference);
    expect(f.outbox.events.map((e) => e.eventType)).toContain("WagerTransactionPendingReference");
  });

  test("REFUND of a WIN is REFERENCE_INVALID_KIND", async () => {
    const f = build();
    await openWallet(f, "100.00");
    await f.submit.execute(cmd({ kind: WagerTransactionKind.Win, externalTransactionId: "win-1", idempotencyKey: "provider-a:win-1" }));
    const r = await f.submit.execute(
      cmd({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: "win-1" }),
    );
    expect(r.failureCode).toBe(FailureCode.ReferenceInvalidKind);
  });

  test("REFUND with wrong value is REFERENCE_VALUE_MISMATCH", async () => {
    const f = build();
    const extId = await seedBet(f, "25.00");
    const r = await f.submit.execute(
      cmd({
        externalTransactionId: "refund-1",
        idempotencyKey: "provider-a:refund-1",
        kind: WagerTransactionKind.Refund,
        money: brl("30.00"),
        referenceExternalTransactionId: extId,
      }),
    );
    expect(r.failureCode).toBe(FailureCode.ReferenceValueMismatch);
  });

  test("double REFUND is REFERENCE_ALREADY_REVERSED", async () => {
    const f = build();
    const extId = await seedBet(f, "25.00");
    await f.submit.execute(
      cmd({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: extId, externalTransactionId: "r1", idempotencyKey: "provider-a:r1" }),
    );
    const r = await f.submit.execute(
      cmd({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: extId, externalTransactionId: "r2", idempotencyKey: "provider-a:r2" }),
    );
    expect(r.failureCode).toBe(FailureCode.ReferenceAlreadyReversed);
  });

  test("REFUND scope mismatch (different wallet) is REFERENCE_SCOPE_MISMATCH", async () => {
    const f = build();
    await openWallet(f, "100.00"); // p1 wallet = id-1
    const p2 = await f.openWallet.execute({ playerId: "p2", initialBalance: brl("0.00") }); // p2 wallet = id-4
    await f.submit.execute(cmd({ money: brl("10.00") })); // BET on p1 (id-1)
    const r = await f.submit.execute(
      cmd({
        externalTransactionId: "refund-1",
        idempotencyKey: "provider-a:refund-1",
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "tx-1",
        walletId: p2.id,
        playerId: "p2",
      }),
    );
    expect(r.failureCode).toBe(FailureCode.ReferenceScopeMismatch);
  });

  test("ROLLBACK of a WIN that would overdraw is REVERSAL_WOULD_OVERDRAW", async () => {
    const f = build();
    await openWallet(f, "100.00");
    await f.submit.execute(cmd({ kind: WagerTransactionKind.Win, externalTransactionId: "win-1", idempotencyKey: "provider-a:win-1", money: brl("80.00") }));
    // spend the balance down
    await f.submit.execute(cmd({ externalTransactionId: "bet-2", idempotencyKey: "provider-a:bet-2", money: brl("180.00") }));
    const r = await f.submit.execute(
      cmd({ kind: WagerTransactionKind.Rollback, referenceExternalTransactionId: "win-1", money: brl("80.00") }),
    );
    expect(r.failureCode).toBe(FailureCode.ReversalWouldOverdraw);
  });

  test("ROLLBACK of a BET credits it back", async () => {
    const f = build();
    const extId = await seedBet(f, "25.00");
    const r = await f.submit.execute(
      cmd({
        externalTransactionId: "rb-1",
        idempotencyKey: "provider-a:rb-1",
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: extId,
      }),
    );
    expect(r.status).toBe(WagerTransactionStatus.Processed);
    expect(r.balance).toEqual({ amount: "100.00", currency: "BRL" });
  });
});

describe("SQS inbox dedup", () => {
  test("the use case records the inbox and the consumer can detect redelivery", async () => {
    const f = build();
    await openWallet(f, "100.00");
    const c = cmd({ consumerName: "wager", messageId: "msg-1" });
    await f.submit.execute(c);
    // the inbox now knows the message was processed → the consumer would ack and skip
    expect(await f.inbox.exists("wager", "msg-1")).toBe(true);
    expect(await f.inbox.exists("wager", "other")).toBe(false);
    expect(f.ledger.entries).toHaveLength(2); // opening + single bet
  });
});
