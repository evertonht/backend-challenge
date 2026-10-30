Type: grilling
Status: resolved

## Question

How are `PENDING_REFERENCE` transactions eventually processed? `README.md` §7.1 requires a scheduled worker with exponential backoff, a justified attempt limit or TTL, and on exhaustion a `REJECTED` with a failure code identifying the missing reference.

Decide: the worker schedule/scan strategy, the backoff schedule, the attempt cap or TTL, and the terminal failure code. The resolution must specify these constants and the full transition path.

## Answer

**Confirmed** (user, 2026-10-30).

- **Mechanism**: scheduled worker (interval ~30s) scans due `PENDING_REFERENCE` rows, claims them `FOR UPDATE SKIP LOCKED` (safe across instances), locks the wallet (ticket 04), and re-attempts reference resolution + application through the same apply logic.
- **Backoff**: exponential — `next_attempt_at = now() + min(30s × 2^attempts, 10m)`. Start fast (references usually arrive in seconds), space out when far away.
- **Limit**: max **8 attempts** and a hard **TTL of 24h**, whichever first. A referenced `BET`/`WIN` that hasn't arrived within a day is effectively never coming.
- **Terminal**: on exhaustion → `REJECTED` with `REFERENCE_NOT_FOUND` + publish `WagerTransactionRejected` (via outbox).
- **Schema delta (amends ticket 05)**: `wager_transaction` gains `attempts int NOT NULL DEFAULT 0` and `next_attempt_at timestamptz` (NULL unless `PENDING_REFERENCE`).
