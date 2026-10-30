Type: task
Status: resolved
Blocked by: 16, 17, 18

# Application layer (ports + use cases)

## Context (read first)

- `ARCHITECTURE.md` §9 (7 ports), §5 (transaction shape), §6 (idempotency hash), §7 (messaging + pending-reference)
- README §7 (business rules), §9 (API semantics), §11 (atomicity)
- tickets 06 (hash), 04 (lock), 11 (failure codes), 15 (module boundaries)

## Deliverables — `src/application/`

1. **Ports** (interfaces only, in `ports/`):
   - `WalletRepository` (`findForUpdate`/`findById`/`save`)
   - `WagerTransactionRepository` (`findByIdempotencyKey`/`findByProviderExternal`/`save`/`findDuePendingReferences`/`findById`)
   - `LedgerEntryRepository` (`append`/`page`/`sum`)
   - `OutboxWriter` (`enqueue`)
   - `IdGenerator` (`nextId`)
   - `Clock` (`now`)
   - `UnitOfWork` (`transactional(fn)`)
   No `IdempotencyStore` (idempotency lives in `WagerTransactionRepository`).

2. **Idempotency hash util** (`idempotency.ts`) — SHA-256 (lowercase hex) of canonical JSON (recursively sorted keys, no whitespace) over the business subset: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money{amount,currency}`, and `referenceExternalTransactionId` when present. (Use `node:crypto`.)

3. **Use cases** (classes with a single public method, injected ports; all financial mutations run inside `UnitOfWork.transactional` with the wallet locked first per §5):
   - `OpenWallet` — create wallet; `initialBalance > 0` → internal `OPENING` `WagerTransaction` + `CREDIT` ledger entry in the same tx; duplicate `(playerId,currency)` → `409`-semantic conflict. Emits no integration event (opening is internal) unless you choose `WalletBalanceChanged` (justify).
   - `SubmitTransaction` — the single business path for both HTTP and SQS:
     - resolve idempotency: same key + same hash → replay (return original result + `idempotentReplay:true`); same key + different hash → `IDEMPOTENCY_CONFLICT`.
     - apply `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK` per §7 with all reference rules (same provider/player/wallet/currency/round; `REFUND`→`BET` only; `ROLLBACK`→`BET|WIN|REFUND`; not reversed twice; value equality; scope/kind/status checks → the 12 failure codes).
     - reference missing → `PENDING_REFERENCE` (emit `WagerTransactionPendingReference`).
     - on success emit `WagerTransactionProcessed` (incl. `LOSS`) and, when balance changed, `WalletBalanceChanged`; on business rejection emit `WagerTransactionRejected`.
     - record inbox (consumer provided, SQS path) in the same tx.
     - return a typed result: `{ status, transactionId, balance?, failureCode?, idempotentReplay }`.
   - `GetWallet`, `GetTransaction` (by internal id and by `(providerId, externalTransactionId)`), `GetLedger` (keyset cursor per ticket 14).
   - `Reconcile` — compare stored balance vs `sum(ledger)`; return `{ storedBalance, calculatedBalance, difference, consistent, checkedEntries }`; **never** silently correct; log + count a metric on divergence.

4. **Result/error model** — application-level result types distinguishing the five §9 outcomes (processed / pending / business-reject-with-failureCode / idempotency-conflict / invalid-payload), so the interface layer only maps to HTTP status. Failures throw domain/application errors carrying `failureCode`.

5. **`application.module.ts`** — register the use cases + port tokens (interfaces provided later by infrastructure). Own this file (only this ticket edits it).

## Tests

Unit-test `SubmitTransaction` with in-memory fake port implementations (fakes, not mocks — allowed for unit tests since these exercise the use-case seam, not Postgres/SQS): BET debit, WIN credit, LOSS no-balance-change, REFUND/ROLLBACK happy path + all reference errors, idempotent replay, idempotency conflict, currency mismatch, pending-reference on out-of-order, and the canonical-hash helper (stable across key ordering).

## Acceptance

- Strict-clean; `bun test` green.
- The 12 failure codes all reachable through `SubmitTransaction` outcomes.
