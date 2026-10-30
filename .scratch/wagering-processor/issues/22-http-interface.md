Type: task
Status: resolved
Blocked by: 16, 19, 20

# HTTP interface (controllers, DTOs, error mapping, health)

## Context (read first)

- README §9 (endpoints + status semantics), §12 (health)
- `ARCHITECTURE.md` §8 (status table, error envelope, ledger cursor)
- tickets 12 (status mapping), 14 (cursor)

## Deliverables — `src/interface/http/`

1. **DTOs** with class-validator: `CreateWalletDto`, `SubmitTransactionDto` (mirrors the README §9 payload), `LedgerQueryDto` (`cursor?`, `limit?` default 50), and `MoneyDto` (`amount`/`currency`). Global `ValidationPipe` (whitelist + transform) → 400 on invalid payload.

2. **Controllers**:
   - `POST /wallets` → 201 / 409 (duplicate `playerId,currency`) / 400.
   - `GET /wallets/:walletId` → 200 / 404.
   - `GET /wallets/:walletId/ledger?cursor&limit` → 200 with `nextCursor` (opaque base64url keyset on `(created_at,id)`), 404 if wallet missing.
   - `POST /wagering/transactions` (reads `Idempotency-Key` header, required) → 200 PROCESSED / 202 pending / 422 business reject / 409 idempotency conflict / 400 invalid / 503 transient.
   - `GET /wagering/transactions/:transactionId` → 200 / 404.
   - `GET /providers/:providerId/wagering/transactions/:externalTransactionId` → 200 / 404.
   - `POST /wallets/:walletId/reconciliation` → 200 `{ storedBalance, calculatedBalance, difference, consistent, checkedEntries }`.
   - `GET /health/live`, `GET /health/ready` (readiness probes Postgres + SQS) — **no auth**.

3. **Error envelope** `{ "error": { "code", "message", "details" } }` consistent everywhere; `code` = the 12-`FailureCode` for business rejections; `500` reserved for unexpected server errors. Map application/domain errors → status (exception filter).

4. **Idempotent replay**: replayed requests return the **original** status + body with `idempotentReplay: true` (a replayed `REJECTED` bet returns 422 again).

5. **`interface.module.ts`** — register controllers + filters. Own this file.

## Acceptance

- Strict-clean; `bun test` green (controller mapping / envelope / status tests with fakes).
- Health endpoints respond without auth; readiness fails when Postgres or SQS is unreachable.
