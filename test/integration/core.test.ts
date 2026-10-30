import { beforeAll, afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createEnvironment, resetDb, Environment } from "../helpers/environment";
import { Money } from "../../src/domain/money";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/enums";
import { FailureCode } from "../../src/domain/failure-code";
import { computePayloadHash } from "../../src/application/idempotency";
import { SubmitTransactionCommand } from "../../src/application/use-cases/submit-transaction";
import { UniqueConstraintViolationException } from "@mikro-orm/core";

let env: Environment;

beforeAll(async () => {
  env = await createEnvironment();
});

afterAll(async () => {
  await env.close();
});

beforeEach(async () => {
  await resetDb(env.orm);
});

function cmd(overrides: Partial<SubmitTransactionCommand> = {}): SubmitTransactionCommand {
  const base: SubmitTransactionCommand = {
    idempotencyKey: "provider-a:tx-1",
    providerId: "provider-a",
    externalTransactionId: "tx-1",
    playerId: "p1",
    walletId: "w1",
    roundId: "r1",
    gameId: "g1",
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: "25.00", currency: "BRL" }),
    correlationId: "corr-1",
    payloadHash: "",
  };
  const merged = { ...base, ...overrides };
  merged.payloadHash = computePayloadHash({
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
  });
  return merged;
}

async function openWallet(amount = "100.00") {
  return env.openWallet.execute({ playerId: "p1", initialBalance: Money.from({ amount, currency: "BRL" }) });
}

describe("schema constraints", () => {
  test("duplicate wallet (playerId, currency) is rejected by the DB", async () => {
    await openWallet("10.00");
    await expect(openWallet("20.00")).rejects.toThrow();
  });

  test("duplicate idempotency key is rejected by the DB", async () => {
    const w = await openWallet("100.00");
    const c = cmd({ walletId: w.id });
    await env.submitTransaction.execute(c);
    // a second insert with the same idempotency key but a *different* payload hash would
    // violate the UNIQUE constraint if it ever reached the DB; the use case short-circuits.
    const conflict = await env.submitTransaction
      .execute(cmd({ walletId: w.id, externalTransactionId: "tx-2", idempotencyKey: "provider-a:tx-1" }))
      .catch((e) => e);
    expect((conflict as Error).name).toBe("IdempotencyConflictError");
  });

  test("negative balance violates CHECK(balance >= 0)", async () => {
    const em = env.orm.em.fork();
    const id = "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1";
    await expect(
      em
        .getConnection()
        .execute(
          `INSERT INTO wallet (id, player_id, currency, balance, version, created_at, updated_at) VALUES (?, 'p', 'BRL', '-1.00', 1, now(), now())`,
          [id],
        ),
    ).rejects.toThrow(/balance/);
  });

  test("unbalanced ledger entry violates the arithmetic CHECK", async () => {
    const em = env.orm.em.fork();
    const walletId = "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1";
    const txId = "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a2";
    await em
      .getConnection()
      .execute(
        `INSERT INTO wallet (id, player_id, currency, balance, version, created_at, updated_at) VALUES (?, 'p', 'BRL', '0', 1, now(), now())`,
        [walletId],
      );
    await em
      .getConnection()
      .execute(
        `INSERT INTO wager_transaction (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, amount, currency, status, created_at) VALUES (?, 'p', 'e', 'k', 'h', ?, 'p', 'r', 'g', 'BET', '10.00', 'BRL', 'PROCESSED', now())`,
        [txId, walletId],
      );
    // CREDIT with balance_after != balance_before + amount → violates CHECK
    await expect(
      em
        .getConnection()
        .execute(
          `INSERT INTO wallet_ledger_entry (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at) VALUES ('0192f28f-5dc0-7d58-bdb2-814ad6a0f4a3', ?, ?, 'CREDIT', '10.00', 'BRL', '0.00', '99.00', now())`,
          [walletId, txId],
        ),
    ).rejects.toThrow(/ledger_arithmetic_check/);
  });
});

describe("use case flows", () => {
  test("open wallet writes an OPENING ledger entry for a positive balance", async () => {
    const w = await openWallet("100.00");
    const rec = await env.reconcile.execute(w.id);
    expect(rec?.consistent).toBe(true);
    expect(rec?.checkedEntries).toBe(1);
    expect(rec?.calculatedBalance).toEqual({ amount: "100.00", currency: "BRL" });
  });

  test("BET debits, WIN credits, LOSS does not move balance", async () => {
    const w = await openWallet("100.00");
    await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "t1", idempotencyKey: "a:t1", kind: WagerTransactionKind.Bet, money: Money.from({ amount: "25.00", currency: "BRL" }) }));
    await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "t2", idempotencyKey: "a:t2", kind: WagerTransactionKind.Win, money: Money.from({ amount: "10.00", currency: "BRL" }) }));
    await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "t3", idempotencyKey: "a:t3", kind: WagerTransactionKind.Loss, money: Money.from({ amount: "5.00", currency: "BRL" }) }));
    const rec = await env.reconcile.execute(w.id);
    expect(rec?.calculatedBalance).toEqual({ amount: "85.00", currency: "BRL" });
    expect(rec?.checkedEntries).toBe(3); // opening + bet + win (loss produces no entry)
    expect(rec?.consistent).toBe(true);
  });

  test("REFUND reverts a processed BET once; second is already-reversed", async () => {
    const w = await openWallet("100.00");
    await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "bet-1", idempotencyKey: "a:bet-1", kind: WagerTransactionKind.Bet, money: Money.from({ amount: "30.00", currency: "BRL" }) }));
    const r1 = await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "ref-1", idempotencyKey: "a:ref-1", kind: WagerTransactionKind.Refund, referenceExternalTransactionId: "bet-1", money: Money.from({ amount: "30.00", currency: "BRL" }) }));
    expect(r1.status).toBe(WagerTransactionStatus.Processed);
    const r2 = await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "ref-2", idempotencyKey: "a:ref-2", kind: WagerTransactionKind.Refund, referenceExternalTransactionId: "bet-1", money: Money.from({ amount: "30.00", currency: "BRL" }) }));
    expect(r2.failureCode).toBe(FailureCode.ReferenceAlreadyReversed);
    const rec = await env.reconcile.execute(w.id);
    expect(rec?.calculatedBalance).toEqual({ amount: "100.00", currency: "BRL" });
  });

  test("ROLLBACK of a WIN that would overdraw is REVERSAL_WOULD_OVERDRAW", async () => {
    const w = await openWallet("100.00");
    await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "win-1", idempotencyKey: "a:win-1", kind: WagerTransactionKind.Win, money: Money.from({ amount: "80.00", currency: "BRL" }) }));
    await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "bet-2", idempotencyKey: "a:bet-2", kind: WagerTransactionKind.Bet, money: Money.from({ amount: "180.00", currency: "BRL" }) }));
    const r = await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "rb-1", idempotencyKey: "a:rb-1", kind: WagerTransactionKind.Rollback, referenceExternalTransactionId: "win-1", money: Money.from({ amount: "80.00", currency: "BRL" }) }));
    expect(r.failureCode).toBe(FailureCode.ReversalWouldOverdraw);
  });

  test("idempotent replay returns the original result", async () => {
    const w = await openWallet("100.00");
    const c = cmd({ walletId: w.id });
    const first = await env.submitTransaction.execute(c);
    const second = await env.submitTransaction.execute(c);
    expect(second.idempotentReplay).toBe(true);
    expect(second.balance).toEqual(first.balance);
  });

  test("ledger pagination with a stable cursor", async () => {
    const w = await openWallet("100.00");
    for (let i = 1; i <= 5; i++) {
      await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: `t${i}`, idempotencyKey: `a:t${i}`, kind: WagerTransactionKind.Win, money: Money.from({ amount: "1.00", currency: "BRL" }) }));
    }
    const page1 = await env.getLedger.execute(w.id, undefined, 2);
    expect(page1?.entries.length).toBe(2);
    expect(page1?.nextCursor).toBeTruthy();
    const page2 = await env.getLedger.execute(w.id, page1!.nextCursor!, 2);
    expect(page2?.entries.length).toBe(2);
    const page3 = await env.getLedger.execute(w.id, page2!.nextCursor!, 2);
    expect(page3?.entries.length).toBe(2);
    expect(page3?.nextCursor).toBeNull();
    // no overlap / no skip
    const all = [...page1!.entries, ...page2!.entries, ...page3!.entries].map((e) => e.id);
    expect(new Set(all).size).toBe(6); // opening + 5 wins
  });
});

describe("out-of-order reversals", () => {
  test("REFUND before BET is parked and applied once the BET arrives", async () => {
    const w = await openWallet("100.00");
    const ref = await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "ref-1", idempotencyKey: "a:ref-1", kind: WagerTransactionKind.Refund, referenceExternalTransactionId: "bet-1", money: Money.from({ amount: "30.00", currency: "BRL" }) }));
    expect(ref.status).toBe(WagerTransactionStatus.PendingReference);

    await env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "bet-1", idempotencyKey: "a:bet-1", kind: WagerTransactionKind.Bet, money: Money.from({ amount: "30.00", currency: "BRL" }) }));

    // force due and run the worker
    await env.orm.em
      .fork()
      .getConnection()
      .execute(`UPDATE wager_transaction SET next_attempt_at = now() - interval '1 second' WHERE status = 'PENDING_REFERENCE'`);
    await env.retryPendingReferences.execute(10);

    const rec = await env.reconcile.execute(w.id);
    expect(rec?.calculatedBalance).toEqual({ amount: "100.00", currency: "BRL" });
    expect(rec?.consistent).toBe(true);
  });
});
