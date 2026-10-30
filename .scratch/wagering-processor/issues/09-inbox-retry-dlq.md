Type: grilling
Status: resolved

## Question

How does the SQS consumer deduplicate, ack, and route to DLQ? `README.md` §10 requires inbox dedup by `(consumerName, messageId)`, ack only after commit, and a distinction between business errors (terminal, ack), transient errors (retry with backoff), and permanent errors (DLQ) with an attempt limit; §6.5 puts inbox in the same SQL transaction.

Decide: the inbox schema/unique key, the ack/visibility strategy, the retry policy (backoff schedule, max attempts), DLQ routing, and `SIGTERM` handling. The resolution must specify these plus the failure-classification rules.

## Answer

**Confirmed** (user, 2026-10-30).

- **Dedup**: inbox `UNIQUE (consumerName, messageId)` inserted in the same SQL transaction as the financial change; a redelivered message finds its row → ack, no re-apply.
- **Ack after commit only**: `DeleteMessage` only after the transaction commits.
- **Classification**:
  - *Business rejection* → record `REJECTED` + outbox event → ack (valid, terminal outcome).
  - *Transient infra* → don't ack; visibility timeout re-delivers; extend visibility with capped exponential backoff.
  - *Permanent / malformed* → don't ack; SQS redrive (`maxReceiveCount`) auto-moves to DLQ.
- **`PENDING_REFERENCE`** → ack (processed as "awaiting reference"; ticket 10's worker advances it later — not SQS redelivery).
- **SIGTERM**: stop polling; finish in-flight (commit + ack) or return to visibility; never ack-before-commit.
- **Redelivery idempotent** via the inbox — no in-memory dedup (§5.2).
- Constants (`maxReceiveCount` ~5, visibility ~30s, backoff schedule) are build-time (left in the map's "not yet specified").
