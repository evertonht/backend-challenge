Type: grilling
Status: resolved

## Question

What is the `failureCode` taxonomy? `README.md` §7.2 requires a stable, machine-readable code on every rejection, sufficient for the provider to decide resend / fix / give up; §7 additionally distinguishes insufficient-balance from a reversal-that-would-go-negative.

Propose the enum (e.g. `INSUFFICIENT_BALANCE`, `REFERENCE_NOT_FOUND`, `CURRENCY_MISMATCH`, `IDEMPOTENCY_CONFLICT`, `INVALID_PAYLOAD`, `REFERENCE_ALREADY_REVERSED`, …) and the domain-error → code mapping. The resolution must define each code and its provider guidance.

## Answer

**Confirmed** (user, 2026-10-30). Twelve stable codes, grouped by where the rejection occurs:

- **Input/transport**: `INVALID_PAYLOAD` (malformed/missing/unknown/bad money → fix), `IDEMPOTENCY_CONFLICT` (same key, different payload → fix).
- **Wallet**: `WALLET_NOT_FOUND` (fix/create), `CURRENCY_MISMATCH` (§6.2 → fix).
- **Balance**: `INSUFFICIENT_BALANCE` (BET exceeds balance → don't resend), `REVERSAL_WOULD_OVERDRAW` (§7.9 → don't resend, distinct from above).
- **Reference**: `REFERENCE_NOT_FOUND` (§7.1 → investigate), `REFERENCE_ALREADY_REVERSED` (§7.4 → don't resend), `REFERENCE_VALUE_MISMATCH` (§7.5 → fix), `REFERENCE_INVALID_KIND` (§7.3 → fix), `REFERENCE_SCOPE_MISMATCH` (§7.2 → fix), `REFERENCE_NOT_PROCESSED` (reference exists but not applied → fix/investigate).

The §7.9 distinction (`INSUFFICIENT_BALANCE` vs `REVERSAL_WOULD_OVERDRAW`) is honored. The four `REFERENCE_*` edge codes are documented interpretations per §7's closing line ("any additional interpretation must be documented").
