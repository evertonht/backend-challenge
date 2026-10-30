Type: task
Status: open
Blocked by: 16, 19, 20

# Messaging (SQS inbox consumer, outbox publisher, pending-reference worker)

## Context (read first)

- README §10 (SQS), §11 (outbox)
- `ARCHITECTURE.md` §7 (all three subsections), §2.1 (MiniStack)
- tickets 08 (outbox), 09 (inbox/retry/DLQ), 10 (pending-reference)
- `docs/research/07-sqs-emulator.md`

## Deliverables — `src/infrastructure/messaging/`

1. **SQS client** — thin wrapper over `@aws-sdk/client-sqs` (`SQSClient` pointed at MiniStack endpoint via env; FIFO queues). Expose `receive`, `delete`, `changeVisibility`, `send` (with `MessageGroupId` for FIFO).

2. **Inbox consumer** (`inbox.consumer.ts`) — long-polls `wager-transactions.fifo`, parses the `WagerTransactionRequested` envelope (`messageId`, `type`, `occurredAt`, `data`), and calls the **same `SubmitTransaction` use case** as HTTP. Rules:
   - dedup via inbox `UNIQUE(consumer_name,message_id)` in the same SQL tx;
   - **ack (`DeleteMessage`) only after commit**;
   - business rejection → terminal → ack; transient infra → no ack + `ChangeMessageVisibility` backoff (capped exponential); permanent/malformed → no ack, let `maxReceiveCount` redrive to `wager-transactions-dlq.fifo`; `PENDING_REFERENCE` → ack.
   - `SIGTERM`: stop polling, finish in-flight (commit+ack) or return visibility; never ack-before-commit.

3. **Outbox publisher** (`outbox.publisher.ts`) — polling worker: claim `FOR UPDATE SKIP LOCKED` due rows, bump `attempts` + commit (short tx), publish to `wager-events.fifo` (outside tx), then mark `published_at` + commit (short tx). At-least-once; exponential backoff via `next_attempt_at`; max-attempts dead-letter. Emit the required metrics (outbox lag, retries).

4. **Pending-reference worker** (`pending-reference.worker.ts`) — scheduled (~30s) scan of due `PENDING_REFERENCE` rows with `FOR UPDATE SKIP LOCKED`, wallet lock, re-attempt resolution via `SubmitTransaction`'s apply path; backoff `30s × 2^n` (cap 10m); max 8 attempts / 24h TTL → `REJECTED` `REFERENCE_NOT_FOUND` + `WagerTransactionRejected`.

5. **`messaging.module.ts`** — providers + `OnModuleInit`/`OnApplicationShutdown` lifecycle for consumers/workers. Own this file.

## Acceptance

- Consumers/workers start/stop cleanly with Nest lifecycle.
- Strict-clean build; `bun test` green (unit-test classification logic with a fake SQS client; heavy integration in ticket 23).
- No SQS publish before the financial transaction commits (outbox is the only publish path).
