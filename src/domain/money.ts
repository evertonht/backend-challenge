import Big from "big.js";
import { CurrencyMismatchError, InvalidMoneyError } from "./errors";

// Never allow a JS number (IEEE-754) to leak into a Money value.
Big.strict = true;

export interface MoneyProps {
  amount: string; // decimal string, always 2dp on the way out, e.g. "25.00"
  currency: string; // ISO-4217
}

const AMOUNT_REGEX = /^\d+(?:\.\d{1,2})?$/;
const CURRENCY_REGEX = /^[A-Z]{3}$/;

/**
 * Immutable money value object (§6.1). Wraps a private `big.js` value; the only
 * operations exposed are exact add/subtract/negate. Input is validated by
 * `Money.from` against a strict regex so NaN/Infinity/scientific notation/
 * empty/>2dp/negative are rejected before the Big is ever constructed.
 */
export class Money {
  private constructor(
    private readonly value: Big,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    const { amount, currency } = props;
    if (typeof amount !== "string" || !AMOUNT_REGEX.test(amount)) {
      throw new InvalidMoneyError(amount);
    }
    if (typeof currency !== "string" || !CURRENCY_REGEX.test(currency)) {
      throw new InvalidMoneyError(currency);
    }
    return new Money(new Big(amount), currency);
  }

  static zero(currency: string): Money {
    if (!CURRENCY_REGEX.test(currency)) {
      throw new InvalidMoneyError(currency);
    }
    return new Money(new Big("0"), currency);
  }

  /**
   * Reconstructs an already-persisted value. Unlike `from`, it does **not**
   * re-run input-contract validation (§6.0) — it trusts the storage round-trip.
   */
  static rehydrate(props: MoneyProps): Money {
    return new Money(new Big(props.amount), props.currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.neg(), this.currency);
  }

  isZero(): boolean {
    return this.value.eq("0");
  }

  isPositive(): boolean {
    return this.value.gt("0");
  }

  isNegative(): boolean {
    return this.value.lt("0");
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lt(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.eq(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.value.toFixed(2), currency: this.currency };
  }

  toString(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
