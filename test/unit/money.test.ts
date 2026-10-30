import { describe, expect, test } from "bun:test";
import { Money } from "../../src/domain/money";
import { CurrencyMismatchError, InvalidMoneyError } from "../../src/domain/errors";

describe("Money.from", () => {
  test("accepts an integer string and normalizes to 2dp", () => {
    expect(Money.from({ amount: "25", currency: "BRL" }).toJSON()).toEqual({
      amount: "25.00",
      currency: "BRL",
    });
  });

  test("normalizes one decimal place to 2dp", () => {
    expect(Money.from({ amount: "25.5", currency: "BRL" }).toString()).toBe("25.50");
  });

  test("keeps an already-2dp value", () => {
    expect(Money.from({ amount: "25.00", currency: "BRL" }).toString()).toBe("25.00");
  });

  test("accepts zero", () => {
    expect(Money.from({ amount: "0", currency: "BRL" }).isZero()).toBe(true);
  });

  test("rejects NaN", () => {
    expect(() => Money.from({ amount: "NaN", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  test("rejects Infinity", () => {
    expect(() => Money.from({ amount: "Infinity", currency: "BRL" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "-Infinity", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  test("rejects scientific notation", () => {
    expect(() => Money.from({ amount: "2.5e1", currency: "BRL" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "25E+1", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  test("rejects empty string", () => {
    expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  test("rejects more than two decimals", () => {
    expect(() => Money.from({ amount: "1.234", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  test("rejects negative amounts", () => {
    expect(() => Money.from({ amount: "-25.00", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  test("rejects leading sign", () => {
    expect(() => Money.from({ amount: "+25.00", currency: "BRL" })).toThrow(InvalidMoneyError);
  });

  test("rejects non-string amount", () => {
    expect(() => Money.from({ amount: 25 as unknown as string, currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
  });

  test("rejects invalid currency", () => {
    expect(() => Money.from({ amount: "25.00", currency: "brl" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "25.00", currency: "BRL9" })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: "25.00", currency: "" })).toThrow(InvalidMoneyError);
  });
});

describe("Money arithmetic (exact)", () => {
  test("0.1 + 0.2 = 0.3 exactly", () => {
    const a = Money.from({ amount: "0.1", currency: "USD" });
    const b = Money.from({ amount: "0.2", currency: "USD" });
    expect(a.add(b).toString()).toBe("0.30");
  });

  test("subtract is exact", () => {
    const a = Money.from({ amount: "100.00", currency: "BRL" });
    const b = Money.from({ amount: "80.00", currency: "BRL" });
    expect(a.subtract(b).toString()).toBe("20.00");
  });

  test("negate", () => {
    expect(Money.from({ amount: "25.00", currency: "BRL" }).negate().toString()).toBe("-25.00");
  });

  test("large exact value has no floating-point drift", () => {
    const a = Money.from({ amount: "999999999999.99", currency: "BRL" });
    const b = Money.from({ amount: "0.01", currency: "BRL" });
    expect(a.add(b).toString()).toBe("1000000000000.00");
  });
});

describe("Money comparisons and currency", () => {
  test("equals by amount and currency", () => {
    const a = Money.from({ amount: "25.00", currency: "BRL" });
    const b = Money.from({ amount: "25.00", currency: "BRL" });
    const c = Money.from({ amount: "25.00", currency: "USD" });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  test("isLessThan", () => {
    expect(Money.from({ amount: "1.00", currency: "BRL" }).isLessThan(Money.from({ amount: "2.00", currency: "BRL" }))).toBe(true);
    expect(Money.from({ amount: "2.00", currency: "BRL" }).isLessThan(Money.from({ amount: "1.00", currency: "BRL" }))).toBe(false);
  });

  test("currency mismatch throws on arithmetic and comparison", () => {
    const brl = Money.from({ amount: "1.00", currency: "BRL" });
    const usd = Money.from({ amount: "1.00", currency: "USD" });
    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
  });

  test("immutability — operations return new instances", () => {
    const a = Money.from({ amount: "25.00", currency: "BRL" });
    const b = a.add(Money.from({ amount: "5.00", currency: "BRL" }));
    expect(a.toString()).toBe("25.00");
    expect(b.toString()).toBe("30.00");
    expect(a).not.toBe(b);
  });
});
