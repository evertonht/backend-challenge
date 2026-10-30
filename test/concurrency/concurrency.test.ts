import { beforeAll, afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createEnvironment, resetDb, Environment } from "../helpers/environment";
import { Money } from "../../src/domain/money";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/enums";
import { computePayloadHash } from "../../src/application/idempotency";
import { SubmitTransactionCommand } from "../../src/application/use-cases/submit-transaction";

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
  });
  return merged;
}

async function openWallet(amount = "100.00") {
  return env.openWallet.execute({ playerId: "p1", initialBalance: Money.from({ amount, currency: "BRL" }) });
}

describe("concurrency (§8, §13)", () => {
  test("mandatory scenario: two 80.00 bets on 100.00 → one PROCESSED, one REJECTED", async () => {
    const w = await openWallet("100.00");
    const [r1, r2] = await Promise.all([
      env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "a", idempotencyKey: "p:a", money: Money.from({ amount: "80.00", currency: "BRL" }) })),
      env.submitTransaction.execute(cmd({ walletId: w.id, externalTransactionId: "b", idempotencyKey: "p:b", money: Money.from({ amount: "80.00", currency: "BRL" }) })),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected]);

    const rec = await env.reconcile.execute(w.id);
    expect(rec?.calculatedBalance).toEqual({ amount: "20.00", currency: "BRL" });
    expect(rec?.consistent).toBe(true);
    // opening + exactly one debit
    expect(rec?.checkedEntries).toBe(2);
  });

  test("the same bet sent 50 times in parallel produces a single debit", async () => {
    const w = await openWallet("100.00");
    const c = cmd({ walletId: w.id, externalTransactionId: "bet-1", idempotencyKey: "p:bet-1", money: Money.from({ amount: "10.00", currency: "BRL" }) });
    const results = await Promise.all(Array.from({ length: 50 }, () => env.submitTransaction.execute(c)));
    const processed = results.filter((r) => !r.idempotentReplay);
    expect(processed.length).toBe(1);

    const rec = await env.reconcile.execute(w.id);
    expect(rec?.calculatedBalance).toEqual({ amount: "90.00", currency: "BRL" });
    expect(rec?.checkedEntries).toBe(2); // opening + one debit
  });

  test("distinct wallets process in parallel without interference", async () => {
    const w1 = await env.openWallet.execute({ playerId: "p1", initialBalance: Money.from({ amount: "100.00", currency: "BRL" }) });
    const w2 = await env.openWallet.execute({ playerId: "p2", initialBalance: Money.from({ amount: "100.00", currency: "BRL" }) });
    await Promise.all([
      env.submitTransaction.execute(cmd({ walletId: w1.id, playerId: "p1", externalTransactionId: "a", idempotencyKey: "p:a", money: Money.from({ amount: "10.00", currency: "BRL" }) })),
      env.submitTransaction.execute(cmd({ walletId: w2.id, playerId: "p2", externalTransactionId: "b", idempotencyKey: "p:b", money: Money.from({ amount: "20.00", currency: "BRL" }) })),
    ]);
    const r1 = await env.reconcile.execute(w1.id);
    const r2 = await env.reconcile.execute(w2.id);
    expect(r1?.calculatedBalance).toEqual({ amount: "90.00", currency: "BRL" });
    expect(r2?.calculatedBalance).toEqual({ amount: "80.00", currency: "BRL" });
  });

  test("three independent instances stay correct under concurrency", async () => {
    const env2 = await createEnvironment();
    const env3 = await createEnvironment();
    try {
      const w = await openWallet("100.00");
      const make = (n: number) =>
        cmd({
          walletId: w.id,
          externalTransactionId: `tx-${n}`,
          idempotencyKey: `p:tx-${n}`,
          money: Money.from({ amount: "30.00", currency: "BRL" }),
        });
      // three instances, three different 30.00 bets, all concurrent
      await Promise.all([
        env.submitTransaction.execute(make(1)),
        env2.submitTransaction.execute(make(2)),
        env3.submitTransaction.execute(make(3)),
      ]);
      const rec = await env.reconcile.execute(w.id);
      // 100 - 30*3 = 10
      expect(rec?.calculatedBalance).toEqual({ amount: "10.00", currency: "BRL" });
      expect(rec?.consistent).toBe(true);
    } finally {
      await env2.close();
      await env3.close();
    }
  });
});
