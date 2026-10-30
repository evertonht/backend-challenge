# Running the Distributed Wagering Processor

## Prerequisites

- **Bun 1.x** — runtime, package manager and test runner (the mandated stack, §4).
  Install via mise: `mise install bun@1 && mise use -g bun@1`.
- **PostgreSQL** and **MiniStack** (local SQS) — either via Docker Compose, or running
  locally (see below). MiniStack is MIT-licensed and needs no account/token.

## 1. Start PostgreSQL + MiniStack

### Option A — Docker Compose (recommended)

```bash
docker compose up -d
```

This starts `postgres:16` (port 5432) and `ministackorg/ministack` (port 4566).

### Option B — local processes (no Docker)

```bash
# PostgreSQL (e.g. via mise)
mise install postgres@17 && mise use -g postgres@17
initdb -D /tmp/pgdata -U postgres -E UTF8 --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 5432" -l /tmp/postgres.log start
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE wagering LOGIN PASSWORD 'wagering' SUPERUSER;"
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE wagering OWNER wagering;"

# MiniStack
mise install python@3.12 && mise use -g python@3.12
pip3 install ministack
ministack   # serves http://localhost:4566
```

## 2. Install dependencies

```bash
bun install
```

## 3. Configure

Copy `.env.example` to `.env` and adjust if needed. Defaults target the
Docker Compose / local setup above (`postgres://wagering:wagering@localhost:5432/wagering`
and `http://localhost:4566`).

## 4. Create the SQS queues

```bash
bun run queues:ensure
```

Idempotently creates `wager-transactions.fifo`, its DLQ `wager-transactions-dlq.fifo`
(with a `maxReceiveCount` redrive policy), and `wager-events.fifo`.

## 5. Run migrations

```bash
bun run migration:up
```

## 6. Run the service

```bash
bun run start:dev   # watch mode
# or
bun run start
```

Health checks (no auth, §9):

```bash
curl localhost:3000/health/live    # 200 — process alive
curl localhost:3000/health/ready   # 200 if Postgres + SQS reachable, else 503
```

## Tests

```bash
bun run test              # domain + application unit tests (no external deps)
bun run test:integration  # PostgreSQL integration tests (requires a running Postgres)
bun run test:concurrency  # real-parallelism concurrency tests (requires Postgres)
```

The integration/concurrency suites connect to `DATABASE_URL` (default
`postgres://wagering:wagering@localhost:5432/wagering`) and run the versioned
migrations themselves.

## API (summary)

| Method | Path | Notes |
|---|---|---|
| POST | `/wallets` | 201 / 409 (duplicate `playerId,currency`) / 400 |
| GET | `/wallets/:walletId` | 200 / 404 |
| GET | `/wallets/:walletId/ledger?cursor&limit` | keyset pagination |
| POST | `/wallets/:walletId/reconciliation` | stored vs ledger-reconstructed balance |
| POST | `/wagering/transactions` | 200 / 202 / 422 / 409 / 400 / 503; `Idempotency-Key` header |
| GET | `/wagering/transactions/:transactionId` | 200 / 404 |
| GET | `/providers/:providerId/wagering/transactions/:externalTransactionId` | 200 / 404 |
| GET | `/health/live`, `/health/ready` | no auth |

## SQS

Providers publish a `WagerTransactionRequested` envelope to
`wager-transactions.fifo` (§10). The consumer reuses the HTTP use case, deduplicates
via a persistent inbox, acks only after commit, and lets `maxReceiveCount` redrive
malformed/permanent failures into `wager-transactions-dlq.fifo`. Outbox events are
published to `wager-events.fifo`.
