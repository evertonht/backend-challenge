Type: grilling
Status: resolved

## Question

How is the idempotency `payloadHash` computed? `README.md` §9 requires a hash of a canonical JSON (sorted keys) of the *business* subset only — the header and transport metadata do not enter the hash — with the algorithm documented.

Decide: the exact field subset, the canonicalization rules, the hash algorithm (e.g. SHA-256 hex), and where `idempotencyKey` vs `payloadHash` each sit in the transaction model. The resolution must document the algorithm and cover the same-key/different-payload conflict case.

## Answer

**Confirmed** (user, 2026-10-30).

- **Business subset**: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money{ amount, currency }`, and `referenceExternalTransactionId` when present. Excluded: the `Idempotency-Key` header and transport metadata (`messageId`, `occurredAt`, `correlationId`, HTTP method). The SQS path hashes the same inner `data` object, not the envelope.
- **Canonicalization**: JSON with keys sorted recursively, no whitespace, UTF-8; `money` is already a decimal string.
- **Algorithm**: SHA-256, lowercase hex.
- **Semantics**: `idempotencyKey` (unique) and `payloadHash` are both stored. Same key + same hash → replay (`idempotentReplay: true`); same key + different hash → conflict (409).
