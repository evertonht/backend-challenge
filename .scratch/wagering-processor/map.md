# Wayfinder Map — Distributed Wagering Processor

## Destination

A decision-complete map: every choice the README leaves open is resolved and recorded — in `ARCHITECTURE.md`, and as ADRs where a decision is hard-to-reverse, surprising, or a real trade-off — such that the Distributed Wagering Processor can be built mechanically. The map ends at **handoff**; it produces no code. Correctness core first.

## Notes

- **Spec**: `README.md` is the authoritative spec — cite it by section number.
- **Domain**: iGaming wagering; providers submit operations (`BET → WIN | LOSS | REFUND | ROLLBACK`) that apply to player wallets. Invariants: no double credit, no double debit, no lost confirmed events, no negative balance.
- **Stack (fixed)**: Bun 1.x, TypeScript strict, NestJS, PostgreSQL, SQS (LocalStack/MiniStack), Docker Compose, versioned + reversible migrations.
- **Skills every session should consult**: `grilling` + `domain-modeling` for decision tickets; `research` for research tickets; `codebase-design` when a decision touches module/port boundaries.
- **Scope posture**: correctness core first (financial, concurrency, idempotency, messaging). Single runtime currency `BRL`, model stays multi-currency, currency-conflict tested (§6.1).
- **Plan only**: this map resolves decisions, not deliverables. No `task` tickets that build code.

## Decisions so far

- [01 — Money representation](issues/01-money-representation.md): use **`big.js`** as the exact-arithmetic engine (exact `add`/`subtract`/`negate`, natively rejects `NaN`/`Infinity`, ~6 KB, zero deps, Bun-safe). `Money.from` gates the raw string with `^\d+(?:\.\d{1,2})?$` and serializes via `toFixed(2)` for fixed 2-dp scale. → `docs/research/01-money-representation.md`
- [07 — SQS emulator](issues/07-sqs-emulator.md): use **MiniStack** — satisfies all §10 needs (FIFO, DLQ + `maxReceiveCount` redrive, visibility-timeout at-least-once, AWS SDK v3), ~65 MB / MIT / no auth token, unlike LocalStack's free tier. Gap (no DLQ-redrive *move-task* APIs) is out of §10's scope. → `docs/research/07-sqs-emulator.md`
- [02 — ORM](issues/02-orm.md): **MikroORM** — UoW + Identity Map + `transactional()` + `LockMode` map onto the aggregate/transactional design; TypeORM rejected (no benefit, more discipline). Document `Money` mapping + transactional strategy in `ARCHITECTURE.md` at build.
- [03 — Money persistence](issues/03-money-persistence.md): `amount numeric(20,2)` (exact, 2-dp scale in the schema, `pg` returns string → 1:1 into `big.js`) + `currency text`; entity rehydrates via `Money.from`, never a JS `number`.
- [04 — Concurrency strategy](issues/04-concurrency-strategy.md): **pessimistic per-wallet locking** — `SELECT … FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`) as the first statement; the §11 unit commits under the held lock; per-row not global (§5.6); `version` kept for audit, not correctness.
- [05 — Schema guarantees](issues/05-schema-guarantees.md): wallet `CHECK(balance>=0)` + `UNIQUE(playerId,currency)`; tx `UNIQUE(idempotencyKey)` + `UNIQUE(providerId, externalTransactionId)`; ledger `UNIQUE(transactionId)` + arithmetic `CHECK` + immutability via GRANT only (no `UPDATE`/`DELETE`, no trigger); inbox `UNIQUE(consumerName,messageId)`; outbox partial index `(next_attempt_at) WHERE published_at IS NULL`.
- [06 — Idempotency hash](issues/06-idempotency-hash.md): SHA-256 (lowercase hex) of canonical JSON (recursively sorted keys) over the business subset (`providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money`, `referenceExternalTransactionId`); same key + same hash = replay, different hash = conflict (409).
- [08 — Outbox publisher](issues/08-outbox-publisher.md): polling + `FOR UPDATE SKIP LOCKED` claim; at-least-once (claim→publish→mark, short txs); exponential backoff + max-attempts dead-letter; consumers dedupe by `eventId`.
- [09 — Inbox + retry/DLQ](issues/09-inbox-retry-dlq.md): inbox `UNIQUE(consumerName,messageId)` in the same tx; ack only after commit; business-reject→ack, transient→visibility backoff, permanent/malformed→maxReceiveCount→DLQ; `PENDING_REFERENCE`→ack (ticket 10 advances); SIGTERM drains or returns visibility.
- [10 — Pending-reference](issues/10-pending-reference.md): scheduled worker + `SKIP LOCKED` claim + wallet lock; backoff `30s × 2^n` capped 10m; max 8 attempts / 24h TTL → `REJECTED` `REFERENCE_NOT_FOUND` + event; `wager_transaction` gains `attempts` + `next_attempt_at`.
- [11 — Failure codes](issues/11-failure-codes.md): 12 stable codes — `INVALID_PAYLOAD`, `IDEMPOTENCY_CONFLICT`, `WALLET_NOT_FOUND`, `CURRENCY_MISMATCH`, `INSUFFICIENT_BALANCE`, `REVERSAL_WOULD_OVERDRAW`, `REFERENCE_NOT_FOUND`, `REFERENCE_ALREADY_REVERSED`, `REFERENCE_VALUE_MISMATCH`, `REFERENCE_INVALID_KIND`, `REFERENCE_SCOPE_MISMATCH`, `REFERENCE_NOT_PROCESSED`.
- [12 — HTTP status](issues/12-http-status.md): 400 invalid / 409 idempotency-conflict / 422 business-reject (body carries `failureCode`) / 202 pending-reference / 503 transient; 201+409 for wallets, 404 for missing reads; replay returns original status+body+`idempotentReplay:true`; error envelope `{error:{code,message,details}}`.
- [13 — ID format](issues/13-id-format.md): **UUIDv7** (time-ordered, RFC 9562) in native `uuid` columns; app-side via an `IdGenerator` port (not DB `gen_random_uuid()` v4); ULID/UUIDv4 rejected.
- [14 — Ledger cursor](issues/14-ledger-cursor.md): keyset pagination on `(created_at, id)` (ascending, `id` tiebreaker), opaque base64url cursor, row-value `(created_at, id) > (?,?)` query; keyset not OFFSET for stability.
- [15 — Module boundaries](issues/15-module-boundaries.md): four layers (domain/application/infrastructure/interface), deps inward; 7 ports — `WalletRepository`, `WagerTransactionRepository`, `LedgerEntryRepository`, `OutboxWriter`, `IdGenerator`, `Clock`, `UnitOfWork`; no separate idempotency store; ledger persisted atomically with wallet.

## Not yet specified

- None — every decision the README leaves open is now resolved. Remaining values (outbox max-attempts, inbox `maxReceiveCount`/visibility, lock timeout) are trivial build-time tuning constants, not decisions.

## Out of scope

- **Load test** (§14 differential) — ruled out at the user's direction.
- **Authentication** (§2) — ruled out at the user's direction. README accepts omission; a later build may drop a no-op `AuthGuard` / `ProviderIdentityPort` as a free extension point, but this map makes no auth decision.
- **Downstream consumer of outbox events** — the outbox publishes to a configurable SQS queue (`wager-events.fifo`); nothing in this challenge consumes those events, so any consumer is out of scope.
