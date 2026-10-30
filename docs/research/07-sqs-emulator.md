# SQS Emulator — LocalStack vs MiniStack

**Status:** research — resolved
**Ticket:** `.scratch/wagering-processor/issues/07-sqs-emulator.md`
**Spec refs:** `README.md` §4 (Stack), §10 (Processamento por SQS), §13 (Testes obrigatórios)

## Recommendation

**Use MiniStack (`ministackorg/ministack`) as the local SQS emulator.**

Both LocalStack and MiniStack satisfy every functional requirement in §10 — FIFO
queues (`wager-transactions.fifo`, `wager-transactions-dlq.fifo`), a DLQ with
`maxReceiveCount` redrive, at-least-once redelivery via visibility timeout, and
per-message retry semantics — and both are protocol-compatible with AWS SDK v3 for
Node/Bun. MiniStack wins on the axes that actually matter for a take-home challenge
orchestrated with Docker Compose:

1. **Zero-friction startup.** MiniStack is MIT-licensed, needs no account, API key,
   auth token, or telemetry ([MiniStack README](https://github.com/ministackorg/ministack);
   [Docker Hub](https://hub.docker.com/r/ministackorg/ministack)). LocalStack now
   **requires a `LOCALSTACK_AUTH_TOKEN`** even for its free non-commercial "Hobby"
   tier, and license activation must succeed or the container exits
   ([LocalStack Auth Token docs](https://docs.localstack.cloud/aws/getting-started/auth-token/);
   [LocalStack Docker Hub](https://hub.docker.com/r/localstack/localstack)). A grader
   running `docker compose up` should not need to register for a LocalStack account.
2. **Materially smaller footprint and faster startup.** MiniStack: ~65 MB compressed
   image (~150 MB uncompressed), ~30 MB RAM idle, ~2 s startup
   ([MiniStack README](https://github.com/ministackorg/ministack);
   [Docker Hub](https://hub.docker.com/r/ministackorg/ministack)). LocalStack: ~332 MB
   compressed image, heavier runtime
   ([LocalStack Docker Hub](https://hub.docker.com/r/localstack/localstack)).
3. **Free tier feature parity, plus persistence.** LocalStack's free "Hobby" tier has
   **no local state persistence** and **enforced telemetry**
   ([LocalStack licensing](https://docs.localstack.cloud/aws/licensing/)). MiniStack
   offers optional `PERSIST_STATE=1` state persistence and a `/_ministack/reset`
   endpoint for clean per-test state ([MiniStack README](https://github.com/ministackorg/ministack)).
4. **SQS fidelity is sufficient — and stricter out of the box in one place.** MiniStack's
   SQS implementation enforces the AWS-default `MessageRetentionPeriod` (4 days) and
   validates `RedrivePolicy`/`maxReceiveCount` (1–1000) and numeric attribute ranges
   against the SQS service model; LocalStack disables `MessageRetentionPeriod` and the
   `PurgeQueue`/`QueueDeletedRecently` 60-second restrictions by default and needs env
   vars to enable them
   ([MiniStack `sqs.py`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py);
   [LocalStack SQS docs](https://docs.localstack.cloud/user-guide/aws/sqs/)).

**Accept the one known gap:** MiniStack implements 18 of the 23 SQS operations; it does
not implement the DLQ-redrive move-task APIs (`StartMessageMoveTask`,
`ListMessageMoveTasks`, `CancelMessageMoveTask`, `ListDeadLetterSourceQueues`)
([MiniStack `sqs.py`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py)).
Those four operations move messages *back out of* a DLQ; §10 only requires messages to
be moved *into* the DLQ once `maxReceiveCount` is exceeded, which MiniStack fully
supports. If explicit DLQ-redrive tooling is ever needed, it is the only thing LocalStack
would add.

---

## LocalStack vs MiniStack comparison

| Axis | LocalStack | MiniStack | Notes / source |
|---|---|---|---|
| License & setup | Hobby (free, non-commercial) **requires account + `LOCALSTACK_AUTH_TOKEN`**; activation failure aborts startup | MIT, free forever, no account/key/token/telemetry | [LocalStack licensing](https://docs.localstack.cloud/aws/licensing/), [auth token](https://docs.localstack.cloud/aws/getting-started/auth-token/); [MiniStack README](https://github.com/ministackorg/ministack) |
| SQS in free tier | ✅ available in Hobby (all plans) | ✅ always free | [LocalStack licensing](https://docs.localstack.cloud/aws/licensing/) |
| Local state persistence (free) | ❌ not in Hobby | ✅ optional `PERSIST_STATE=1` | [LocalStack licensing](https://docs.localstack.cloud/aws/licensing/); [MiniStack README](https://github.com/ministackorg/ministack) |
| Telemetry (free) | enforced in Hobby | none | [LocalStack licensing](https://docs.localstack.cloud/aws/licensing/); [MiniStack Docker Hub](https://hub.docker.com/r/ministackorg/ministack) |
| Image size (compressed) | ~332 MB (`localstack` = pro) | ~65 MB (~150 MB uncompressed) | [LocalStack Docker Hub](https://hub.docker.com/r/localstack/localstack); [MiniStack Docker Hub](https://hub.docker.com/r/ministackorg/ministack) |
| Startup / idle RAM | heavier (~1 GB image class) | ~2 s startup, ~30 MB RAM idle | [MiniStack README](https://github.com/ministackorg/ministack) (LocalStack figure is MiniStack's own comparison) |
| FIFO queues | ✅ `.fifo` + `FifoQueue=true` | ✅ `.fifo`; 5-min dedup window, content-based dedup, message-group ordering, sequence numbers | [LocalStack SQS docs](https://docs.localstack.cloud/user-guide/aws/sqs/); [MiniStack `sqs.py`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py) |
| DLQ + `maxReceiveCount` redrive | ✅ RedrivePolicy + `maxReceiveCount`; moved messages carry `DeadLetterQueueSourceArn` | ✅ RedrivePolicy validated (1–1000); `_dlq_sweep` moves on `receiveCount >= maxReceiveCount`; adds `DeadLetterQueueSourceArn` | [LocalStack SQS docs](https://docs.localstack.cloud/user-guide/aws/sqs/); [MiniStack `sqs.py`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py) |
| DLQ redrive *out* (move tasks) | ✅ full 23/23 ops incl. move tasks | ❌ not implemented | [LocalStack coverage](https://docs.localstack.cloud/api-coverage/v1/services/sqs.md); [MiniStack `sqs.py`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py) |
| Visibility timeout | ✅ default 30 s, `ChangeMessageVisibility(Batch)` | ✅ default 30 s (range 0–43200), `ChangeMessageVisibility(Batch)`, long polling | [LocalStack SQS docs](https://docs.localstack.cloud/user-guide/aws/sqs/); [MiniStack `sqs.py`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py) |
| At-least-once / redelivery | ✅ redelivers unacked messages; `ApproximateReceiveCount` | ✅ `receive_count` + `visible_at`; unacked messages reappear; `ApproximateReceiveCount` exposed | [LocalStack SQS docs](https://docs.localstack.cloud/user-guide/aws/sqs/); [MiniStack `sqs.py`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py) |
| `MessageRetentionPeriod` | ❌ disabled by default (`SQS_ENABLE_MESSAGE_RETENTION_PERIOD=1`) | ✅ enforced by default (AWS default 4 days) | [LocalStack SQS docs](https://docs.localstack.cloud/user-guide/aws/sqs/); [MiniStack `sqs.py`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py) |
| `PurgeQueue` / delete 60 s guard | ❌ disabled by default (env vars to enable) | (not modeled) | [LocalStack SQS docs](https://docs.localstack.cloud/user-guide/aws/sqs/) |
| AWS SDK v3 protocol | ✅ Query + JSON | ✅ Query + JSON (`X-Amz-Target: AmazonSQS.*`) + `awsQueryCompatible` error mapping | [MiniStack `sqs.py`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py) |
| Test ergonomics | `/_aws/sqs/messages` peek endpoint | `/_ministack/sqs/messages` peek + `/_ministack/reset` (clean state per test) | [LocalStack SQS docs](https://docs.localstack.cloud/user-guide/aws/sqs/); [MiniStack README](https://github.com/ministackorg/ministack) |
| Maturity | 10+ yrs, 500M+ Docker pulls | younger (5.1k ⭐, active) | [LocalStack Docker Hub](https://hub.docker.com/r/localstack/localstack); [MiniStack GitHub](https://github.com/ministackorg/ministack) |

---

## AWS SDK v3 + Bun compatibility notes

- The AWS SDK for JavaScript v3 SQS client (`@aws-sdk/client-sqs`) targets Node.js,
  browser, and React Native, and **defaults to the AWS JSON (RPC) 1.0 protocol**
  (`X-Amz-Target: AmazonSQS.*`), with the legacy AWS Query protocol available as an opt-in
  via `@aws-sdk/config/protocol`
  ([`client-sqs` README](https://github.com/aws/aws-sdk-js-v3/blob/main/clients/client-sqs/README.md)).
  Both emulators speak both protocols, so the SDK v3 default works unmodified.
- The JS SDK v3 SQS client sends `SendMessage`/`ReceiveMessage`/`DeleteMessage` directly
  to the `QueueUrl` host (`useQueueUrlAsEndpoint` defaults true). MiniStack reflects the
  caller's `Host` header back into queue URLs (the same approach LocalStack takes), so a
  client on the Docker network reaches the emulator container rather than `localhost`
  ([MiniStack `sqs.py` `_externalize_url`](https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py)).
- Bun is designed as a "drop-in replacement for Node.js" and treats any Node package that
  fails on Bun as a Bun bug
  ([Bun Node.js compatibility](https://bun.com/docs/runtime/nodejs-compat)). The SDK v3 is
  Node-targeted, so `@aws-sdk/client-sqs` runs under Bun; no emulator-specific Bun caveats
  exist because the emulator is reached over plain HTTP(S) on a single port, not through
  any Bun API.

---

## Fidelity to the SQS failure modes required by §13

§13's integration and concurrency tests need a broker that reproduces *at-least-once
redelivery*, *DLQ after N receives*, and *visibility-timeout in-flight semantics*. MiniStack's
`sqs.py` implements exactly these, and both emulators satisfy the same set:

| §13 test / §10 requirement | SQS mechanism | MiniStack support (source) |
|---|---|---|
| Inbox dedup `(consumerName, messageId)` + redelivery (§10, §13 "inbox e redelivery") | message stays in-flight until deleted; reappears after visibility timeout | `receive_count`/`visible_at`; unacked messages become visible again |
| "retry e DLQ" (§13) | `maxReceiveCount` redrive into `wager-transactions-dlq.fifo` | `_validate_redrive_policy` + `_dlq_sweep` moves on `receive_count >= maxReceiveCount` |
| ack-only-after-commit (§10) | consumer deletes only after commit; crash → redelivery | `DeleteMessage`/`DeleteMessageBatch` remove by receipt handle |
| "worker morto depois do commit e antes do ack" (§13.5) | message re-delivered after visibility timeout; `ApproximateReceiveCount` increments | `visible_at = now + vis_timeout`; `ApproximateReceiveCount` exposed |
| transient retry w/ backoff (§10) | consumer calls `ChangeMessageVisibility` to extend in-flight time | `ChangeMessageVisibility`/`ChangeMessageVisibilityBatch` set `visible_at` |
| "≥3 processos/instâncias simultâneos" (§13.4) | multiple concurrent `ReceiveMessage` consumers; FIFO group ordering | `_collect_fifo` enforces one in-flight message per group, send-order delivery |
| publishers concorrentes / 50 parallel sends (§13.1, §13.6) | concurrent `SendMessage(Batch)` | handlers are per-request; FIFO dedup returns the first message id on duplicate |
| FIFO ordering (§10 `.fifo` queues) | message-group ordering + dedup | `_collect_fifo` + 5-min dedup window + sequence numbers |

The broker is treated as an **optimization, not the correctness guarantee** (§8, §5.3):
dedup, idempotency, and ordering invariants are ultimately enforced by the inbox/ledger in
PostgreSQL. MiniStack reproduces the *failure modes* the tests exercise (redelivery, DLQ
routing, visibility-timeout expiry, FIFO group ordering) faithfully enough that the
application's own recovery paths are what the tests actually stress.

---

## Sources (primary)

- LocalStack SQS service docs — https://docs.localstack.cloud/user-guide/aws/sqs/
- LocalStack SQS API coverage (23/23, "available starting with the Hobby plan") — https://docs.localstack.cloud/api-coverage/v1/services/sqs.md
- LocalStack licensing & tiers — https://docs.localstack.cloud/aws/licensing/
- LocalStack Auth Token (mandatory credential) — https://docs.localstack.cloud/aws/getting-started/auth-token/
- LocalStack Docker image — https://hub.docker.com/r/localstack/localstack
- MiniStack README (license, footprint, SQS feature list, internal API) — https://github.com/ministackorg/ministack
- MiniStack SQS service source — https://github.com/ministackorg/ministack/blob/main/ministack/services/sqs.py
- MiniStack Docker image — https://hub.docker.com/r/ministackorg/ministack
- AWS SDK for JavaScript v3 `@aws-sdk/client-sqs` (protocols) — https://github.com/aws/aws-sdk-js-v3/blob/main/clients/client-sqs/README.md
- Bun Node.js compatibility — https://bun.com/docs/runtime/nodejs-compat
