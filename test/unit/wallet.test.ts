import { describe, expect, test } from "bun:test";
import { Wallet } from "../../src/domain/wallet";
import { Money } from "../../src/domain/money";
import { LedgerDirection } from "../../src/domain/enums";
import { CurrencyMismatchError, InsufficientBalanceError } from "../../src/domain/errors";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

describe("Wallet.open", () => {
  test("opens with the given balance and version 1", () => {
    const w = Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("1000.00") });
    expect(w.balance.toString()).toBe("1000.00");
    expect(w.version).toBe(1);
    expect(w.currency).toBe("BRL");
    expect(w.playerId).toBe("p1");
  });
});

describe("Wallet.debit / credit", () => {
  test("debit returns a balanced DEBIT entry and updates balance + version", () => {
    const w = Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("100.00") });
    const entry = w.debit({ entryId: "e1", transactionId: "t1", money: brl("80.00") });
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.isBalanced()).toBe(true);
    expect(entry.balanceBefore.toString()).toBe("100.00");
    expect(entry.balanceAfter.toString()).toBe("20.00");
    expect(w.balance.toString()).toBe("20.00");
    expect(w.version).toBe(2);
  });

  test("credit returns a balanced CREDIT entry", () => {
    const w = Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("0.00") });
    const entry = w.credit({ entryId: "e1", transactionId: "t1", money: brl("50.00") });
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.isBalanced()).toBe(true);
    expect(w.balance.toString()).toBe("50.00");
    expect(w.version).toBe(2);
  });

  test("debit that would go negative throws InsufficientBalanceError and does not mutate", () => {
    const w = Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("10.00") });
    expect(() => w.debit({ entryId: "e1", transactionId: "t1", money: brl("10.01") })).toThrow(
      InsufficientBalanceError,
    );
    expect(w.balance.toString()).toBe("10.00");
    expect(w.version).toBe(1);
  });

  test("currency mismatch throws", () => {
    const w = Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("10.00") });
    expect(() =>
      w.debit({ entryId: "e1", transactionId: "t1", money: Money.from({ amount: "1.00", currency: "USD" }) }),
    ).toThrow(CurrencyMismatchError);
  });

  test("version only increments when balance changes", () => {
    const w = Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("0.00") });
    // a zero-amount credit must not bump version
    w.credit({ entryId: "e1", transactionId: "t1", money: brl("0.00") });
    expect(w.version).toBe(1);
  });

  test("balance reconstructed from ledger equals wallet balance (invariant)", () => {
    const w = Wallet.open({ id: "w1", playerId: "p1", initialBalance: brl("0.00") });
    let reconstructed = brl("0.00");
    const e1 = w.credit({ entryId: "e0", transactionId: "opening", money: brl("100.00") });
    reconstructed = reconstructed.add(e1.money);
    const e2 = w.debit({ entryId: "e1", transactionId: "t1", money: brl("80.00") });
    reconstructed = reconstructed.subtract(e2.money);
    const e3 = w.credit({ entryId: "e2", transactionId: "t2", money: brl("15.00") });
    reconstructed = reconstructed.add(e3.money);
    expect(reconstructed.equals(w.balance)).toBe(true);
    expect(w.balance.toString()).toBe("35.00");
  });
});
