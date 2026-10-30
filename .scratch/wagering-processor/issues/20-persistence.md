Type: task
Status: open
Blocked by: 16, 18, 19

# Persistence (MikroORM entities, repositories, migrations)

## Context (read first)

- `ARCHITECTURE.md` §4 (schema), §2.2 (MikroORM), §2.4 (UUIDv7), §5 (pessimistic lock)
- tickets 03 (money persistence), 05 (schema guarantees), 13 (id format)
- `docs/research/01-money-representation.md`

## Deliverables — `src/infrastructure/persistence/`

1. **MikroORM entities** mirroring the domain (persistence models; use snake_case columns, `uuid` ids):
   - `WalletEntity` — `id uuid PK`, `playerId`, `currency`, `balance numeric(20,2)`, `version int`, timestamps; `UNIQUE(player_id,currency)`; `CHECK(balance >= 0)`.
   - `WagerTransactionEntity` — `UNIQUE(idempotency_key)`, `UNIQUE(provider_id,external_transaction_id)`, `payload_hash`, `kind`, `status`, `amount`/`currency`, `reference_external_transaction_id`, `reference_transaction_id`, `failure_code`, `attempts int DEFAULT 0`, `next_attempt_at`, timestamps; indexes `(wallet_id)`, `(status)`, `(wallet_id,created_at)`.
   - `WalletLedgerEntryEntity` — `UNIQUE(transaction_id)`, `direction`, `amount`, `currency`, `balance_before`, `balance_after`; index `(wallet_id, created_at, id)`; arithmetic `CHECK`; **immutability via GRANT only** (app role `SELECT`+`INSERT`, no `UPDATE`/`DELETE`) — encode this in a migration that creates a dedicated role + grants (no trigger).
   - `InboxMessageEntity` — `UNIQUE(consumer_name,message_id)`.
   - `OutboxMessageEntity` — `payload jsonb`, `attempts`, `next_attempt_at`, `published_at`; partial index `(next_attempt_at) WHERE published_at IS NULL`.
2. **Money custom type** (`money-type.ts`) — map `amount numeric(20,2)` + `currency text` to/from `Money` (rehydrate via `Money.rehydrate`, never `number`).
3. **Repositories** implementing the 7 application ports: `WalletRepository` (uses `LockMode.PESSIMISTIC_WRITE` via `findForUpdate`), `WagerTransactionRepository`, `LedgerEntryRepository` (`page` implements the keyset cursor query from ticket 14; `sum` for reconciliation), `OutboxWriter`, plus the `UnitOfWork` (`em.transactional`) implementation.
4. **`IdGenerator`** — UUIDv7 (RFC 9562) via `Bun.randomUUIDv7` (fall back to a small v7 implementation if the Bun API is absent — do **not** use `gen_random_uuid()`).
5. **`Clock`** — system clock (injectable; tests can override).
6. **Migrations** (versioned + reversible) creating the schema, constraints, indexes, and the GRANT-only ledger role. Wire `mikro-orm.config.ts`.
7. **`persistence.module.ts`** — provide entities + repositories + `IdGenerator`/`Clock`/`UnitOfWork` bindings. Own this file.

## Acceptance

- Migrations apply cleanly against Postgres and are reversible.
- Constraints enforced at DB level (uniqueness, non-negativity, ledger arithmetic CHECK, immutability role) — demonstrated by an integration test in ticket 23; here at least ensure migrations run.
- Strict-clean build; `bun test` green (mapping/repository unit tests with a real Postgres via docker are allowed but the heavy integration lives in ticket 23).
