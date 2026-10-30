Type: research
Status: resolved

## Question

Which library (or strategy) should represent the `Money` value as exact decimal arithmetic in Bun + TypeScript? The `README.md` §6.1 skeleton requires a `Decimal` type with fixed 2-decimal scale, immutable arithmetic (`add`, `subtract`, `negate`), and rejection of `NaN`/`Infinity`/scientific notation/empty string/>2 decimals.

Investigate primary sources (library docs, source, credible benchmarks) for `decimal.js`, `big.js`, `decimal.js-light`, and an integer-cents (`bigint`/string) approach, and recommend one. The resolution must specify: the library, its rounding/scale handling, immutability guarantees, and how it satisfies §6.1's validation rules.

## Answer

Use **`big.js`** as the exact-arithmetic engine wrapped by the immutable `Money` value object (the skeleton's `private readonly value: Decimal` is typed as `Big`). `big.js` gives a hard exactness guarantee for the only operations `Money` needs — its README states *"The arithmetic methods always return the exact result except `div`, `sqrt` and `pow`"* — whereas `decimal.js` rounds every operation to 20 significant digits. `big.js` also rejects `NaN`/`Infinity` natively, offers `Big.strict` to forbid `number` input, is ~6 KB with no dependencies, uses ECMAScript 3 only (so it runs unchanged on Bun's JavaScriptCore engine), and is actively maintained (v7.0.1, 2025). Input validation is still done in `Money.from` with a strict regex `^\d+(?:\.\d{1,2})?$` (no library rejects scientific notation strings), then the value is normalized and always serialized via `toFixed(2)` so `amount` stays a fixed 2-decimal string. The `bigint`-cents strategy is exact-by-construction and dependency-free but was rejected for the extra hand-rolled parse/format/JSON surface it would require.

Findings: [docs/research/01-money-representation.md](../../../docs/research/01-money-representation.md)
