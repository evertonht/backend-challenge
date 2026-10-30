Type: task
Status: resolved
Blocked by: 16, 17

# Domain model (entities, enums, errors, events)

## Context (read first)

- README §6.0 (modeling rule), §6.2 Wallet, §6.3 WagerTransaction, §6.4 LedgerEntry, §6.5 Inbox/Outbox, §7 (business rules), §11 (event envelope)
- `ARCHITECTURE.md` §3 (domain model), §6 (idempotency semantics)
- `CONTEXT.md` glossary — use its vocabulary exactly.

## Deliverables — pure TS, `src/domain/`, zero deps, no NestJS/ORM imports, private constructors + static factories (`create`/`from`/`rehydrate`; `rehydrate` never revalidates transitions):

1. `enums.ts` — `WagerTransactionKind` (`OPENING|BET|WIN|LOSS|REFUND|ROLLBACK`), `WagerTransactionStatus` (`PENDING|PENDING_REFERENCE|PROCESSED|REJECTED|FAILED`), `LedgerDirection` (`DEBIT|CREDIT`).
2. `failure-code.ts` — the 12 codes from ticket 11: `INVALID_PAYLOAD`, `IDEMPOTENCY_CONFLICT`, `WALLET_NOT_FOUND`, `CURRENCY_MISMATCH`, `INSUFFICIENT_BALANCE`, `REVERSAL_WOULD_OVERDRAW`, `REFERENCE_NOT_FOUND`, `REFERENCE_ALREADY_REVERSED`, `REFERENCE_VALUE_MISMATCH`, `REFERENCE_INVALID_KIND`, `REFERENCE_SCOPE_MISMATCH`, `REFERENCE_NOT_PROCESSED`.
3. `errors.ts` — domain error hierarchy (e.g. `DomainError`, `InvalidTransactionStateError`, `CurrencyMismatchError`, `InsufficientBalanceError`, `ReversalWouldOverdrawError`, reference-validation errors, `InvalidMoneyError`). Each maps to a `FailureCode` where relevant.
4. `wallet.ts` — `Wallet` aggregate: `open({id, playerId, initialBalance})`, `rehydrate(state)`, `get balance/version/updatedAt`, `debit`/`credit` returning the resulting `WalletLedgerEntry` (keeping balance+ledger consistent), `assertSameCurrency`. `version` starts 1 and increments only on balance change.
5. `wager-transaction.ts` — `WagerTransaction` per §6.3: `create(props)` validates reference requirement by kind (`REFUND`/`ROLLBACK` require `referenceExternalTransactionId`), `rehydrate(state)`; transitions `markProcessed(referenceTransactionId?, at)`, `markPendingReference()`, `reject(code)`, `fail(code)` all throw `InvalidTransactionStateError` if current state is terminal; queries `isTerminal()`, `affectsBalance()` (false for LOSS), `requiresReference()`, `matchesPayload(hash)`, `ledgerDirectionFor(reference?)`. `OPENING` is internal (not submittable — guard in `create`).
6. `ledger-entry.ts` — `WalletLedgerEntry` immutable: `create` validates `balanceBefore ± money === balanceAfter` (`isBalanced()`), `rehydrate`. No mutators.
7. `inbox-message.ts` — `InboxMessage`: `receive(props)`, `rehydrate`, `isProcessed()`, `markProcessed(at)`.
8. `outbox-message.ts` — `OutboxMessage`: `enqueue(event)`, `rehydrate`, `isPending()`, `isDue(now)`, `markPublished(at)`, `scheduleRetry(now)` (increments `attempts` + exponential backoff).
9. `events.ts` — abstract `IntegrationEvent<T>` (per §11 envelope: `eventId`, `aggregateId`, `correlationId`, `causationId?`, `occurredAt`, `data`, abstract `eventType`/`version`, `toJSON()`) + four concrete subclasses with `static from(...)` and `data` carrying `MoneyProps` (never `Money` instances):
   - `WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged` (only when balance changes), `WagerTransactionPendingReference`.

## Tests (`bun test`, domain unit tests)

- Wallet: open with `initialBalance > 0` → single `CREDIT` opening entry; debit/credit keep `balance == ledger`; version increments only on balance change; currency mismatch throws; balance never negative (guard in debit).
- WagerTransaction: full state machine — `PENDING → PROCESSED/REJECTED/FAILED` terminal and irreversible; `PENDING → PENDING_REFERENCE → PROCESSED|REJECTED`; terminal transitions throw; `REFUND`/`ROLLBACK` require reference; `OPENING` not submittable; `matchesPayload`; `ledgerDirectionFor`.
- Ledger entry arithmetic validation; `isBalanced`.
- Inbox/Outbox: `markProcessed`, `isDue`, `scheduleRetry` backoff.
- Idempotency payload-hash mismatch (same key, different hash = conflict semantics — helper lives in application, but test the domain surface it exposes).

## Acceptance

- `bun test` green; strict-clean build.
- The invariant `wallet.balance == Σ ledger` holds by construction in every test.
