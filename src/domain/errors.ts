/**
 * Base domain error hierarchy. Pure TypeScript — no framework/ORM imports.
 *
 * Each concrete domain error either carries a `FailureCode` (business rules,
 * see `failure-code.ts`) or is a programming/invariant violation.
 */

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A malformed money amount/currency (NaN, Infinity, scientific notation, >2dp, negative, …). */
export class InvalidMoneyError extends DomainError {
  constructor(public readonly amount: unknown) {
    super(`Invalid money amount: ${String(amount)}`);
  }
}

/** An operation between two different currencies (README §6.1). */
export class CurrencyMismatchError extends DomainError {
  constructor(
    public readonly left: string,
    public readonly right: string,
  ) {
    super(`Currency mismatch: ${left} vs ${right}`);
  }
}
