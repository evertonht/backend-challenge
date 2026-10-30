Type: grilling
Status: resolved

## Question

What are the module boundaries and DDD layering? The domain classes (`Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`) are pure and must not depend on ORM types or NestJS decorators (§6.1).

Decide the NestJS module layout — domain (pure), application (use cases + ports), infrastructure (ORM, SQS, outbox publisher), interface (HTTP controllers, SQS consumers) — and the port/adapters seams (e.g. `WalletRepository`, `EventPublisher`, `IdempotencyStore`). The resolution must specify the module graph and the seams the domain never crosses.

## Answer

**Four layers + seven ports** (confirmed by the user, 2026-10-30).

- **Layers** (dependencies point inward): `domain` (pure TS, zero deps), `application` (use cases + ports + transaction boundary), `infrastructure` (adapters: MikroORM, SQS/MiniStack, workers, migrations), `interface` (HTTP controllers + DTOs, SQS consumer entry points).
- **Ports (seams)**: `WalletRepository` (`findForUpdate`/`findById`/`save`), `WagerTransactionRepository` (`findByIdempotencyKey`/`findByProviderExternal`/`save`), `LedgerEntryRepository` (`append`/`page`), `OutboxWriter` (`enqueue`), `IdGenerator` (`nextId`), `Clock` (`now`), `UnitOfWork` (`transactional`).
- **Calls**: no separate `IdempotencyStore` port (idempotency lives inside `WagerTransactionRepository`); the ledger entry is persisted atomically with the wallet through the `UnitOfWork`. Each port stays deep — a small interface hiding real behavior (e.g. `findByIdempotencyKey` hides replay-vs-conflict from the use case).
