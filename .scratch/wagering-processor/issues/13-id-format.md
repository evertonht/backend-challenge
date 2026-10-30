Type: grilling
Status: resolved

## Question

What ID scheme identifies wallets, transactions, ledger entries, and events? The `README.md` examples use `0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1` — a UUIDv7-shaped, time-ordered ID.

Decide UUIDv7 vs ULID vs UUIDv4 (or another), and whether IDs are generated in the application or database. The resolution must justify the choice for index-friendliness and sortability (ledger ordering, cursor pagination in ticket 14).

## Answer

**UUIDv7** (confirmed by the user, 2026-10-30).

- **UUIDv7** (RFC 9562): time-ordered → good B-tree locality on high-insert tables (ledger, transactions, outbox) and a sensible tiebreaker for the keyset cursor (ticket 14). Stored in native `uuid` columns.
- **Generation — app-side** via an `IdGenerator` port used by the domain factories (`Bun.randomUUIDv7()` or the `uuid` package). Not DB-side: Postgres `gen_random_uuid()` yields v4, and app-side generation keeps the domain pure and lets an ID exist before persistence.
- **Rejected**: ULID (same ordering, but not a UUID — 26-char string, no version nibble — and the README examples are UUIDs) and UUIDv4 (random → index fragmentation, no ordering for cursors).
