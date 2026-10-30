Type: grilling
Status: resolved

## Question

How does the transactional-outbox publisher work with multiple concurrent publishers without losing or duplicating events indefinitely? `README.md` §11 requires atomicity (financial change + ledger + inbox + outbox in one SQL transaction) and a worker that publishes pending events; §5.4 forbids publishing before commit.

Decide: polling vs `LISTEN/NOTIFY`, the claim/lease strategy (e.g. `FOR UPDATE SKIP LOCKED`), at-least-once delivery + consumer idempotency, retry/backoff on publish failure, and the ordering of publish-then-mark. The resolution must specify the worker loop and how §11's crash-and-recover scenario (commit, die before publish, another instance takes over) holds.

## Answer

**Polling + `FOR UPDATE SKIP LOCKED`, at-least-once** (confirmed by the user, 2026-10-30).

- **Trigger**: polling on an interval (baseline). `LISTEN/NOTIFY` is a latency optimization deferred to later — it is not a correctness mechanism.
- **Claim**: `SELECT … FROM outbox_message WHERE published_at IS NULL AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT N FOR UPDATE SKIP LOCKED` — safe for N concurrent publishers (each row claimed by exactly one worker).
- **Delivery**: at-least-once, short DB transactions — (1) claim tx bumps `attempts` and commits; (2) publish to SQS outside any transaction; (3) mark `published_at` and commit. Crash between publish and mark → duplicate publish, which consumers dedupe by the envelope's `eventId`.
- **Retry**: exponential backoff via `next_attempt_at`; a max-attempts cap dead-letters so nothing retries indefinitely (§11).
- **§11 crash-recover scenario**: commit → die before publish → another instance claims the still-`published_at IS NULL` row and publishes → duplicate is safe for the consumer.
- **Destination**: a configurable SQS queue (`wager-events.fifo` by convention, env-driven). The README names only the inbound queue + DLQ (§10); the output queue is our convention, and downstream consumers are out of scope.
