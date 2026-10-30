# Money Representation — Research (ticket 01)

> Resolves: which library/strategy backs the exact `Decimal` inside `Money` (§6.1), under Bun 1.x + TypeScript strict + NestJS.

## Recommendation (TL;DR)

Use **`big.js`** as the exact-arithmetic engine hidden behind the `Money` value object. The `private readonly value: Decimal` field in the §6.1 skeleton is typed as `Big` (the `big.js` type), and `Money.from` validates the raw `amount` string with a strict regex **before** constructing the `Big`.

Why `big.js` over the alternatives:

1. **Hard exactness guarantee for the only operations `Money` needs.** `Money` only exposes `add`, `subtract`, `negate` (no division). big.js documents that *"The arithmetic methods always return the exact result except `div`, `sqrt` and `pow` (with negative exponent)"* — so add/subtract/negate are **exact, always, with no configuration** (source: https://github.com/MikeMcl/big.js#readme). `decimal.js` instead rounds *every* operation to `precision` (default 20 significant digits), a weaker guarantee.
2. **Rejects `NaN`/`Infinity` natively** as a second line of defense — *"`Infinity`, `NaN` and hexadecimal literal strings… are not valid"* (https://mikemcl.github.io/big.js/). `decimal.js` treats them as *valid* values.
3. **`Big.strict = true` disallows primitive-number input**, preventing an IEEE-754 `number` from ever leaking into the value (https://mikemcl.github.io/big.js/).
4. **Smallest, dependency-free, engine-agnostic.** ~6 KB minified, *"Uses ECMAScript 3 only"*, no dependencies (https://github.com/MikeMcl/big.js#readme). Runs identically on Bun's JavaScriptCore engine.
5. **Actively maintained** — v7.0.1 (published 2025), sponsored by Coinbase (https://registry.npmjs.org/big.js/latest).

Costs, all minor and mitigated by the `Money` wrapper: no bundled TypeScript types (use `@types/big.js` from DefinitelyTyped), and its `c`/`e`/`s` properties are technically mutable (we keep the `Big` private and never touch them).

The integer-cents (`bigint`) strategy is the strongest zero-dependency alternative and is exact by construction, but it requires hand-rolling a string↔cents parser/formatter and `JSON.stringify` handling that `big.js` already provides correctly. It is the fallback if a dependency is forbidden.

---

## Requirements recap (README §6.1)

From `README.md` §6.1:

> `Money` é **imutável**: toda operação retorna uma nova instância.

> - `amount` é **recebido e serializado como string decimal**, sempre com escala fixa de **2** casas;
> - operações entre moedas diferentes lançam erro de domínio;
> - entradas inválidas são rejeitadas: `NaN`, `Infinity`, notação científica, string vazia, mais de 2 casas decimais, valores negativos em contratos de entrada;

The skeleton stores `private readonly value: Decimal` and exposes `add`, `subtract`, `negate`, comparison predicates, and `toJSON()/toString()`.

Two things follow from the spec:

- **No division/multiplication** exists on `Money`, so we only need *exact addition and subtraction* (and negation).
- **Input validation is a `Money` concern, not a library concern.** Every candidate library accepts scientific-notation strings (e.g. `'4.321e+4'`), so the spec's "reject scientific notation" can only be satisfied by validating the raw string ourselves before handing it to the library.

---

## Comparison of options

| Criterion | `decimal.js` | `big.js` | `decimal.js-light` | integer cents (`bigint`) |
|---|---|---|---|---|
| Exactness (add/sub) | Rounds **every** op to `precision` (20 sig. digits) | **Exact** (only `div`/`sqrt`/`pow` round) | **Truncates** every op to `precision` | **Exact** by construction |
| `NaN`/`Infinity` | Valid values | **Rejected (throws)** | **Rejected** | N/A (you own parsing) |
| Scientific notation accepted? | Yes (also hex/bin/oct) | Yes (exponential) | Yes (exponential) | N/A (you own parsing) |
| Immutability | Methods immutable | Methods immutable; `c`/`e`/`s` props mutable | Methods immutable | Primitive → immutable |
| Fixed 2-dp | via `toFixed(2)` | via `toFixed(2)` | via `toFixed(2)` | hand-written pad |
| Bun compatibility | ES3 only → engine-agnostic | ES3 only → engine-agnostic | ES3 only → engine-agnostic | ES2020 `BigInt` (supported in JSC) |
| Bundled TS types | Yes (`decimal.d.ts`) | No (`@types/big.js`) | Yes (`decimal.d.ts`) | N/A (native) |
| Minified size | 32.1 KB | **6 KB** | 12.7 KB | 0 |
| Latest version / year | 10.6.0 / 2025 | **7.0.1 / 2025** | 2.5.1 / **2020 (stale)** | N/A |

### 1. `decimal.js`

Full-featured arbitrary-precision `Decimal`. Primary sources:

- *"An arbitrary-precision Decimal type for JavaScript."* and *"A Decimal instance is immutable in the sense that it is not changed by its methods."* — https://mikemcl.github.io/decimal.js/
- **Rounds all arithmetic to precision:** *"The maximum number of significant digits of the result of an operation. … Default value: `20`"* and *"All functions which return a Decimal will round the return value to `precision` significant digits except `Decimal`, `absoluteValue`, `ceil`, `floor`, `negated`, `round`, `toDecimalPlaces`, `toNearest` and `truncated`."* — https://mikemcl.github.io/decimal.js/
- **`NaN`/`Infinity` are valid:** `new Decimal(Infinity) // 'Infinity'`, `new Decimal(NaN) // 'NaN'`, and *"there are `isNaN` and `isFinite` methods, as `NaN` and `Infinity` are valid `Decimal` values."* — https://github.com/MikeMcl/decimal.js#readme
- **Accepts scientific + hex/bin/oct:** `new Decimal('4.321e+4') // '43210'`, `new Decimal('0xff.8') // '255.5'` — https://mikemcl.github.io/decimal.js/
- **Weight/maintenance:** minified 32.1 KB (per https://github.com/MikeMcl/decimal.js-light#readme); v10.6.0, `unpackedSize` 284,347 B (https://registry.npmjs.org/decimal.js/latest); *"uses JavaScript 1.5 (ECMAScript 3) features only"* and bundles `decimal.d.ts` (https://github.com/MikeMcl/decimal.js#readme).

**Assessment.** Rich but overkill: `Money` needs none of `sqrt`/`exp`/trig/non-integer `pow`. Its `NaN`/`Infinity`-as-valid philosophy is the opposite of §6.1, and its round-everything model is a weaker exactness story than big.js. The literal name match (`Decimal`) is cosmetic — §6.1 explicitly allows adapting names/signatures ("Nomes e assinaturas podem ser adaptados").

### 2. `big.js` — recommended

Small, fast, exact. Primary sources:

- **Exact arithmetic:** *"The arithmetic methods always return the exact result except `div`, `sqrt` and `pow` (with negative exponent), as these methods involve division."* — https://github.com/MikeMcl/big.js#readme
- **Rejects `NaN`/`Infinity`:** *"`Infinity`, `NaN` and hexadecimal literal strings, e.g. '0xff', are not valid."* and *"Throws if `n` is invalid."* — https://mikemcl.github.io/big.js/
- **Strict mode rejects numbers:** *"When set to `true`, an error will be thrown if a primitive number is passed to the Big constructor…"* — https://mikemcl.github.io/big.js/
- **Scientific notation is accepted** (so we still validate strings ourselves): *"String values may be in exponential, as well as normal notation."* — https://mikemcl.github.io/big.js/
- **Immutability caveat:** *"A Big number is immutable in the sense that it is not changed by its methods."* but *"A Big number is mutable in the sense that the value of its properties can be changed."* (`c`/`e`/`s` are writable) — https://mikemcl.github.io/big.js/
- **`toFixed` pads to fixed scale in normal notation:** `y.toFixed(3) // '45.600'`, and *"Unlike `Number.prototype.toFixed`… this method will always return normal notation."* — https://mikemcl.github.io/big.js/
- **Weight/maintenance:** *"Only 6 KB minified"* and *"Uses ECMAScript 3 only"* — https://github.com/MikeMcl/big.js#readme; v7.0.1, `unpackedSize` 58,948 B (https://registry.npmjs.org/big.js/latest); TypeScript types via `@types/big.js` (DefinitelyTyped) per https://github.com/MikeMcl/big.js#readme.

**Assessment.** Best fit. Exact add/subtract/negate with no rounding or configuration; native rejection of `NaN`/`Infinity`; tiny; actively maintained; runs on any ES3 engine (Bun's JavaScriptCore included). The mutable `c`/`e`/`s` and missing bundled types are neutralized by keeping the `Big` private inside `Money` and adding `@types/big.js`.

### 3. `decimal.js-light`

The light sibling of decimal.js. Primary sources:

- **Rejects `NaN`/`Infinity`:** *"This library does not include `NaN`, `Infinity` or `-0` as legitimate values, or work with values in other bases."* — https://github.com/MikeMcl/decimal.js-light#readme
- **Truncates arithmetic:** *"It [rounding] does not apply to arithmetic operations, which are simply truncated at the required precision."* — https://github.com/MikeMcl/decimal.js-light#readme
- **Size:** *"Size of `decimal.js-light` minified: 12.7 KB."* — https://github.com/MikeMcl/decimal.js-light#readme; v2.5.1, `unpackedSize` 218,255 B (https://registry.npmjs.org/decimal.js-light/latest); bundles `decimal.d.ts`.

**Assessment.** Its `NaN`/`Infinity` rejection aligns with §6.1, but arithmetic is *truncated* to `precision` (a subtler footgun than big.js's exact add/sub), and it is **stale**: latest release 2.5.1 dates to 2020 (registry metadata shows `_npmVersion 6.14.6` / Node 14.11.0 era). For `Money` it buys nothing over big.js.

### 4. Integer cents (`bigint` / string)

Store the amount as integer cents in a `bigint` (or a validated digit string) and only format to `"25.00"` at the boundary. Primary sources on the underlying type:

- **`BigInt` is arbitrary-precision and exact:** *"`BigInt` values represent integer values which are too high or too low to be represented by the `number` primitive."* — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt
- **Caveats:** division truncates — *"Division (`/`) truncates fractional components towards zero"* (irrelevant for add/sub); and *"Using `JSON.stringify()` with any BigInt value will raise a `TypeError`"* (needs explicit string serialization). — same MDN page.
- **Why `number` is forbidden:** *"The JavaScript `Number` type is a double-precision 64-bit binary format IEEE 754 value… Integers can only be represented without loss of precision in the range −2⁵³+1 to 2⁵³−1."* — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number (this is the reason for §5.1 "Não usar `number`, `float` ou `double` para dinheiro").

**Assessment.** Exact by construction and zero-dependency — a legitimate choice — but it moves the correctness burden onto hand-written parsing (`"25.00"`→`2500n`), formatting (`2500n`→`"25.00"` with left-padding), comparison, and `toJSON` (which the value object must implement anyway). `big.js` already delivers all of that correctly in 6 KB with a large test suite. Rejected here in favor of `big.js`, retained as the fallback if dependencies are undesirable.

---

## Validation strategy mapped to README §6.1

All validation lives in the `Money.from(props: MoneyProps)` factory (the `private constructor` takes an already-validated `Big` + currency). The `rehydrate` factory (§6.0) reconstructs from already-persisted state and does **not** re-run input-contract validation.

### Step 1 — validate `amount` as a string

Apply a strict regex before constructing the `Big`:

```
/^\d+(?:\.\d{1,2})?$/
```

This single regex satisfies every §6.1 rejection rule on the *raw string*:

| §6.1 rule | How the regex rejects it | Example rejected |
|---|---|---|
| `NaN` | no letters match | `"NaN"` |
| `Infinity` | no letters match | `"Infinity"`, `"-Infinity"` |
| scientific notation | no `e`/`E` allowed | `"2.5e1"`, `"25E+1"` |
| empty string | `\d+` requires ≥1 digit | `""` |
| >2 decimals | `\.\d{1,2}` caps at 2 | `"1.234"` |
| negative values | no leading `-`/`+` | `"-25.00"` |

### Step 2 — normalize to fixed 2-dp scale

`§6.1` says `amount` is serialized *"sempre com escala fixa de 2 casas"* while rejecting only *"mais de 2 casas decimais"*. Interpretation adopted: **inputs may carry 0–2 decimals and are normalized to exactly 2** (`"25"`→`"25.00"`, `"25.5"`→`"25.50"`); inputs with **more** than 2 are rejected. The fixed scale is a property of the serialized form, enforced at the boundary via `Big#toFixed(2)`, not stored in the `Big` (which, like all three libraries, drops trailing zeros internally).

If a stricter reading is ever desired (require exactly `"X.YY"` on input), change `\.\d{1,2}` to `\.\d{2}` — a one-line change.

### Step 3 — construct the exact value behind a private field

```ts
// A dedicated, isolated constructor so config never leaks across the app.
const MoneyDecimal = Big();        // new independent constructor
MoneyDecimal.strict = true;        // reject number input (defense in depth)
```

`Money.from` then does `new MoneyDecimal(amount)` (string only). Because `big.js` also independently rejects `NaN`/`Infinity` strings, even a bypass of the regex cannot create a `Big` holding `NaN`.

### Step 4 — exact, immutable arithmetic

- `add` / `subtract` → `this.value.plus(other.value)` / `this.value.minus(other.value)` (exact, no rounding).
- `negate` → `this.value.neg()`.
- `assertSameCurrency` throws a domain error on currency mismatch before any arithmetic.
- Each returns a **new** `Money` (the `Big` methods already return new instances; we never mutate `value` or its `c`/`e`/`s`).
- Currency validated as ISO-4217: `/^[A-Z]{3}$/` (optionally against a code set); `Money.zero(currency)` produces `"0.00"`.

### Step 5 — serialization

- `toJSON(): MoneyProps` and `toString(): string` both emit `this.value.toFixed(2)` — always normal notation, always exactly 2 decimals (never scientific). This is what guarantees the contract shape `{ "amount": "25.00", "currency": "BRL" }`.

---

## Runtime notes (Bun 1.x / JavaScriptCore)

- Bun's engine is **JavaScriptCore**, not V8: *"Bun … is written in Rust and powered by JavaScriptCore"* — https://bun.sh/docs.
- `big.js` (and `decimal.js`, `decimal.js-light`) use only ES3 features ("Uses ECMAScript 3 only"), so they are engine-agnostic and run identically under JSC — no Bun-specific compatibility risk.
- The `bigint` alternative is ES2020; JavaScriptCore supports it (BigInt is Baseline "Widely available" — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt), so it would also work, but it is not needed for the recommendation.

## Sources

- `decimal.js` API — https://mikemcl.github.io/decimal.js/
- `decimal.js` README — https://github.com/MikeMcl/decimal.js#readme
- `big.js` API — https://mikemcl.github.io/big.js/
- `big.js` README — https://github.com/MikeMcl/big.js#readme
- `decimal.js-light` README — https://github.com/MikeMcl/decimal.js-light#readme
- npm registry metadata — https://registry.npmjs.org/decimal.js/latest , https://registry.npmjs.org/big.js/latest , https://registry.npmjs.org/decimal.js-light/latest
- MDN `BigInt` — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt
- MDN `Number` — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number
- Bun docs — https://bun.sh/docs
