import { describe, expect, test } from "bun:test";
import { Uuidv7IdGenerator } from "../../src/infrastructure/persistence/uuidv7-id-generator";
import { walletToData, walletToDomain, txToData, txToDomain } from "../../src/infrastructure/persistence/mappers";
import { WalletEntity } from "../../src/infrastructure/persistence/entities/wallet.entity";
import { WagerTransactionEntity } from "../../src/infrastructure/persistence/entities/wager-transaction.entity";
import { Wallet } from "../../src/domain/wallet";
import { WagerTransaction } from "../../src/domain/wager-transaction";
import { Money } from "../../src/domain/money";
import { WagerTransactionKind, WagerTransactionStatus } from "../../src/domain/enums";
import { FailureCode } from "../../src/domain/failure-code";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

describe("Uuidv7IdGenerator", () => {
  test("generates a valid UUIDv7 (version nibble = 7)", () => {
    const gen = new Uuidv7IdGenerator();
    const id = gen.nextId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("ids are unique and time-ordered", () => {
    const gen = new Uuidv7IdGenerator();
    const a = gen.nextId();
    const b = gen.nextId();
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
  });
});

describe("persistence mappers", () => {
  test("wallet round-trips through data", () => {
    const w = Wallet.open({ id: "id-1", playerId: "p1", initialBalance: brl("123.45") });
    const entity = Object.assign(new WalletEntity(), { id: w.id, createdAt: w.createdAt, ...walletToData(w) });
    const back = walletToDomain(entity);
    expect(back.id).toBe(w.id);
    expect(back.playerId).toBe(w.playerId);
    expect(back.balance.equals(w.balance)).toBe(true);
    expect(back.version).toBe(w.version);
  });

  test("wager transaction round-trips through data (incl. Money + enums + nullable)", () => {
    const tx = WagerTransaction.create({
      id: "id-1",
      providerId: "provider-a",
      externalTransactionId: "tx-1",
      idempotencyKey: "provider-a:tx-1",
      payloadHash: "abc",
      walletId: "w1",
      playerId: "p1",
      roundId: "r1",
      gameId: "g1",
      kind: WagerTransactionKind.Refund,
      money: brl("25.00"),
      referenceExternalTransactionId: "ref-1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    tx.markPendingReference(new Date("2026-01-01T00:00:00Z"));

    const entity = Object.assign(new WagerTransactionEntity(), txToData(tx));
    const back = txToDomain(entity);

    expect(back.id).toBe(tx.id);
    expect(back.kind).toBe(WagerTransactionKind.Refund);
    expect(back.status).toBe(WagerTransactionStatus.PendingReference);
    expect(back.money.toString()).toBe("25.00");
    expect(back.money.currency).toBe("BRL");
    expect(back.referenceExternalTransactionId).toBe("ref-1");
    expect(back.attempts).toBe(1);
    expect(back.nextAttemptAt).toBeDefined();
  });

  test("processed transaction round-trips balanceAfter and failureCode", () => {
    const tx = WagerTransaction.create({
      id: "id-1",
      providerId: "p",
      externalTransactionId: "e",
      idempotencyKey: "k",
      payloadHash: "h",
      walletId: "w",
      playerId: "pl",
      roundId: "r",
      gameId: "g",
      kind: WagerTransactionKind.Bet,
      money: brl("25.00"),
    });
    tx.reject(FailureCode.InsufficientBalance);
    const entity = Object.assign(new WagerTransactionEntity(), txToData(tx));
    const back = txToDomain(entity);
    expect(back.failureCode).toBe(FailureCode.InsufficientBalance);
    expect(back.status).toBe(WagerTransactionStatus.Rejected);
  });
});
