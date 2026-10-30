Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

How is `Money` persisted exactly and rehydrated as `Money`? `README.md` §6.1 allows amount + currency in separate columns as long as the representation is exact and rehydrates as `Money`.

Decide the column types (e.g. `numeric(20,2)` vs string) and the ORM mapping (custom type / transformer / embedded value object), given the resolution of ticket 01 (library) and ticket 02 (ORM). The resolution must guarantee no floating-point representation and lossless round-tripping to a valid `Money`.

## Answer

**`amount numeric(20,2)` + `currency text`** (option a; confirmed by the user, 2026-10-30).

- `amount numeric(20,2)`: Postgres `numeric` is exact arbitrary-precision decimal — no float at either layer. Scale 2 matches §6.1's fixed 2-dp rule and is declared in the schema (the column rounds an over-scale value on insert, a backstop; the strict reject of >2dp lives in `Money.from`).
- `currency text`: ISO-4217 3-letter code, validated by `Money`; model stays multi-currency (§6.1), scale is always 2.
- Mapping: the `pg` driver returns `numeric` as a string (`'25.00'`) by default, so it round-trips 1:1 into `big.js` with no conversion; the MikroORM entity exposes a `Money` rehydrated via `Money.from` (custom `Type` or `@Embedded` — build-time detail). Never a JS `number`.
- Keeps SQL-side `SUM`/ordering for reconciliation (§9) and a natural `CHECK (balance >= 0)` (ticket 05).
