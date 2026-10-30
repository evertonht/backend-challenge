Type: research
Status: resolved

## Question

LocalStack, MiniStack, or another option for the local SQS? `README.md` §4 lists LocalStack/MiniStack; §10 requires FIFO queues, a DLQ with redrive, at-least-once delivery, visibility timeout, and per-message retry semantics.

Investigate primary sources for both: FIFO support, DLQ + `maxReceiveCount` redrive, visibility-timeout behavior, resource footprint, AWS SDK v3 (Node/Bun) compatibility, and how well each reproduces real SQS failure modes. Recommend one with justification.

## Answer

Recommendation: **MiniStack** (`ministackorg/ministack`). Both LocalStack and MiniStack satisfy every §10 requirement (FIFO queues, DLQ + `maxReceiveCount` redrive, visibility-timeout at-least-once redelivery, and AWS SDK v3 JSON/Query protocol support), but MiniStack wins on the axes that matter for a Docker-Compose take-home challenge: it is MIT-licensed with **no account, auth token, or telemetry** (LocalStack now requires a `LOCALSTACK_AUTH_TOKEN` even for its free Hobby tier and aborts on activation failure), has a **~65 MB image / ~30 MB RAM / ~2 s startup** (vs LocalStack's ~332 MB+ and heavier runtime), and offers **optional `PERSIST_STATE=1`** where LocalStack's free tier has no local persistence. MiniStack's SQS implementation faithfully reproduces the failure modes §13 exercises (redelivery via visibility timeout, `ApproximateReceiveCount`, DLQ routing on `maxReceiveCount`, FIFO group ordering + 5-minute dedup, `ChangeMessageVisibility` for backoff). The only known gap is the four DLQ-redrive *move-task* APIs, which §10 does not require (messages only need to move *into* the DLQ). Full comparison and sources: [`docs/research/07-sqs-emulator.md`](../../../docs/research/07-sqs-emulator.md).
