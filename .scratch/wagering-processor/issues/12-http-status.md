Type: grilling
Status: resolved

## Question

What is the HTTP status mapping? `README.md` §9 requires the API to distinguish — consistently across all endpoints — invalid payload, idempotency conflict, business-rule rejection, accepted-but-pending, and transient infra failure, without collapsing them into one code.

Decide the exact status codes (e.g. 400/409/422/202/503) and the error body shape. The resolution must map each §9 outcome to a code and define the response schema.

## Answer

**Confirmed** (user, 2026-10-30).

- **Five §9 outcomes**: `400` invalid payload, `409` idempotency conflict, `422` business rejection (body carries the ticket-11 `failureCode` + `status: REJECTED`), `202` accepted-pending (`PENDING_REFERENCE`), `503` transient infra.
- **Endpoint-specific**: `POST /wallets` → `201`/`409` (duplicate `playerId,currency`)/`400`; reads → `200`/`404`; `POST /wagering/transactions` → `200` PROCESSED / `202` pending / `422` reject / `409` conflict / `400` invalid / `503` transient; reconciliation → `200` (with `consistent` flag).
- **Idempotent replay**: returns the *original* status + body + `idempotentReplay: true` (a replayed `REJECTED` bet returns `422` again, not 200).
- **Error envelope** (consistent everywhere): `{ "error": { "code", "message", "details" } }` — `code` = ticket-11 `failureCode` for business rejections; `500` reserved as the unexpected-server-error catch-all.
