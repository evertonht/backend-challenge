Type: grilling
Status: resolved
Blocked by: 02, 04

## Question

What database-level schema, constraints, and indexes enforce §5.9 (uniqueness, immutability, non-negativity must live in the schema, not just app code)?

Decide, at minimum: unique `(playerId, currency)` on wallet; unique idempotency key; unique `(providerId, externalTransactionId)`; `CHECK (balance >= 0)`; ledger immutability (no update/delete grants, or triggers); at-most-one ledger entry per transaction per wallet; and the indexes backing lookups and keyset pagination. The resolution must specify each constraint and why it holds under concurrency (informed by ticket 04).

## Answer

**Schema contract confirmed** (user, 2026-10-30). Immutability via **GRANT only** (no trigger); **ledger arithmetic CHECK added**.

- **wallet**: `id` PK (uuidv7), `playerId`, `currency`; `balance numeric(20,2)` + `CHECK (balance >= 0)`; `version int` (starts 1, increments on balance change); `UNIQUE (playerId, currency)`; `createdAt`, `updatedAt`.
- **wager_transaction**: `id` PK; `UNIQUE (idempotency_key)`; `UNIQUE (provider_id, external_transaction_id)`; `wallet_id` FK → wallet; `playerId`, `roundId`, `gameId`, `kind`, `amount`/`currency`, `payload_hash`, `reference_external_transaction_id`, `reference_transaction_id`, `status`, `failure_code`, `createdAt`, `processedAt`. Indexes: `(wallet_id)`, `(status)` (pending-reference worker), `(wallet_id, created_at)`.
- **wallet_ledger_entry** (immutable): `id` PK; `wallet_id` FK, `transaction_id` FK; `UNIQUE (transaction_id)`; `direction` (`DEBIT`/`CREDIT`), `amount`, `currency`, `balance_before`, `balance_after`, `created_at`; `INDEX (wallet_id, created_at, id)`; arithmetic `CHECK ((direction='CREDIT' AND balance_after = balance_before + amount) OR (direction='DEBIT' AND balance_after = balance_before - amount))`. **Immutability = GRANT only**: app role gets `SELECT`+`INSERT`, no `UPDATE`/`DELETE` (no trigger).
- **inbox_message**: `UNIQUE (consumer_name, message_id)`; `messageId`, `consumerName`, `payload_hash`, `receivedAt`, `processedAt`.
- **outbox_message**: `id`, `aggregate_id`, `event_type`, `payload jsonb`, `occurred_at`, `attempts`, `next_attempt_at`, `published_at`; partial index `(next_attempt_at) WHERE published_at IS NULL`.

Uniqueness/immutability/non-negativity all live in the schema, so idempotency is persistent (§5.2), references resolve unambiguously (§7.2), the ledger is append-only (§5.5), and balance never goes negative.

**Amendment (from ticket 10)**: `wager_transaction` also carries `attempts int NOT NULL DEFAULT 0` and `next_attempt_at timestamptz` (NULL unless `PENDING_REFERENCE`) for the pending-reference worker's retry bookkeeping.
