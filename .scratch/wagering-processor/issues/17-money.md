Type: task
Status: open
Blocked by: 16

# Money value object

## Context (read first)

- README §6.1 (Money skeleton, rules, contract shape)
- `docs/research/01-money-representation.md` (the exact validation + `big.js` strategy)
- `ARCHITECTURE.md` §2.3

## Deliverables

Implement `src/domain/money.ts` (and any needed error type in `src/domain/errors.ts`, or a `money.errors.ts` — keep the domain dependency-free, no NestJS/ORM imports):

- `MoneyProps { amount: string; currency: string }`.
- `class Money` with `private constructor(private readonly value: Big, public readonly currency: string)`.
- Factories: `Money.from(props)` (validates), `Money.zero(currency)`, `Money.rehydrate(props)` (does **not** re-run input-contract validation — reconstructs already-persisted state, §6.0).
- Immutable ops returning **new** `Money`: `add(other)`, `subtract(other)`, `negate()`.
- Predicates: `isZero()`, `isPositive()`, `isNegative()`, `isLessThan(other)`, `equals(other)`.
- `toJSON(): MoneyProps`, `toString(): string` (both `toFixed(2)` normal notation).
- Private `assertSameCurrency(other)` throwing a domain error on mismatch.

Validation rules (exact, from the research):
- `amount` must match `^\d+(?:\.\d{1,2})?$` (rejects `NaN`, `Infinity`, scientific notation, empty, >2 decimals, negatives).
- Currency matches `/^[A-Z]{3}$/`.
- Use an isolated `Big()` constructor with `strict = true` (never leak `Big`; never a JS `number`).

## Tests (`bun test`)

Cover: valid inputs normalize to 2dp (`"25"`→`"25.00"`, `"25.5"`→`"25.50"`); rejection of `NaN`/`Infinity`/`"2.5e1"`/`""`/`"1.234"`/`"-25"`/`"25.00 BRL"`-style junk; `add`/`subtract`/`negate` exactness (e.g. `0.1`+`0.2` = `0.3`); currency-mismatch throws; `zero`; `equals`/`isLessThan`; `toJSON` shape.

## Acceptance

- `bun test` green; `bun run build` strict-clean.
- No `number`/`float` anywhere in the money path.
