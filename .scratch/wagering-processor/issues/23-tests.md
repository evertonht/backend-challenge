Type: task
Status: open
Blocked by: 16, 19, 20, 21, 22

# Integration + concurrency tests (real PostgreSQL and MiniStack)

## Context (read first)

- README §13 (mandatory tests + final invariant), §8 (mandatory concurrency scenario)
- spec.md §Testing Decisions

## Deliverables — `test/integration/`, `test/concurrency/`

Use **real containers** (Postgres + MiniStack from `docker-compose.yml`); **never** substitute Postgres or SQS with mocks (§13 eliminating failure). Manage per-test state via MiniStack `/_ministack/reset` and DB truncation/migration-reset. Run with `bun test` (integration/concurrency scripts).

### Integration

- migrations apply + constraints hold (uniqueness, non-negativity, ledger arithmetic CHECK, immutability role → attempts to `UPDATE`/`DELETE` a ledger row fail).
- atomicity: a failure mid-submit rolls back wallet + ledger + inbox + outbox together.
- inbox dedup + redelivery (same message id → no re-apply).
- outbox: concurrent publishers over the same outbox don't lose or indefinitely duplicate events.
- retry + DLQ: a message that always fails transiently reaches the DLQ after `maxReceiveCount`.
- recovery after restart: publish → commit → die before publish → another instance publishes.

### Concurrency (real parallelism, not sequential mocks)

1. same `BET` sent **50× in parallel** → exactly one debit.
2. §8 mandatory scenario: 100.00, two 80.00 bets in parallel → one PROCESSED, one REJECTED, balance 20.00, exactly one debit entry.
3. distinct wallets process in parallel.
4. **≥3 concurrent consumers/instances** remain correct.
5. worker dies after commit and before ack → redelivery is idempotent.
6. two outbox publishers concurrently.
7. `ROLLBACK`/`REFUND` delivered before its reference → `PENDING_REFERENCE`, later applied by the worker.
8. service restart → final consistency holds.

### Final invariant (assert in every financial test)

`wallet.balance == balance reconstructed by summing the ledger`.

## Acceptance

- `bun run test:integration` and `bun run test:concurrency` pass against live containers.
- The invariant assertion is present and green.
