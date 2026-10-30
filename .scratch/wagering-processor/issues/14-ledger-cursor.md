Type: grilling
Status: resolved

## Question

How does the ledger cursor pagination work? `README.md` §9 requires `GET /wallets/:walletId/ledger?cursor=…&limit=50` with a stable, opaque cursor.

Decide the keyset ordering (e.g. `(createdAt, id)`), the cursor encoding (opaque, e.g. base64), and how the ordering ties to the ID scheme (ticket 13). The resolution must specify the cursor format and the exact query.

## Answer

**Keyset pagination on `(created_at, id)`** (confirmed by the user, 2026-10-30).

- Order ascending; `id` (UUIDv7, time-ordered) is the tiebreaker for equal `created_at`.
- Cursor: an opaque base64url blob of the last row's `(created_at, id)`, returned as `nextCursor`; the client echoes it back verbatim.
- Query (row-value comparison): `WHERE wallet_id = :walletId AND (created_at, id) > (:cursorCreatedAt, :cursorId) ORDER BY created_at, id LIMIT :limit` (default 50).
- Keyset, not `OFFSET`: the ledger is append-only and shared, so `OFFSET` shifts under concurrent inserts (unstable) and degrades on deep pages; keyset is stable by construction and uses the `(wallet_id, created_at, id)` index from ticket 05.
