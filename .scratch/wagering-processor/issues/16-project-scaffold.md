Type: task
Status: resolved

# Project scaffold

Foundation for the whole build. Everything else is `Blocked by: 16`.

## Context (read first)

- Spec: `.scratch/wagering-processor/spec.md` (§Stack, §Module boundaries, §Observability)
- Decisions: `ARCHITECTURE.md` §2 (stack), §9 (module layout), §10 (observability trade-offs)
- README §4 (obligatory stack), §12 (observability)

## Deliverables

1. **Bun 1.x + TypeScript strict + NestJS** project at repo root:
   - `package.json` (deps below), `tsconfig.json` (strict, `experimentalDecorators` + `emitDecoratorMetadata`, ES2022 target, module resolution that Bun + `@mikro-orm` accept), `tsconfig.build.json`, `.env.example`, `.gitignore`, `nest-cli.json` (or bun-native build).
   - Scripts: `start`, `start:dev`, `build`, `test`, `test:integration`, `test:concurrency`, `migration:create`, `migration:up`, `migration:down`. Use `bun` as package manager, test runner (`bun test`), and runtime.

2. **Dependencies** (prod): `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`, `reflect-metadata`, `rxjs`, `@mikro-orm/core`, `@mikro-orm/postgresql`, `@mikro-orm/migrations`, `@mikro-orm/reflection`, `big.js`, `@aws-sdk/client-sqs`, `pino`, `pino-pretty` (dev). Dev: `typescript`, `@types/node`, `@types/big.js`, `@nestjs/cli`, `pino-pretty`. Do **not** add Jest — the test runner is `bun test`.

3. **Directory skeleton** with the four layers, each owning its own NestJS feature module file so later tickets never edit `app.module.ts`:
   - `src/main.ts` — bootstrap Nest, global validation pipe, JSON logger, SIGTERM hook stub.
   - `src/app.module.ts` — imports the feature modules below; **only ticket 16 edits this file**.
   - `src/config/configuration.ts` — typed env (PORT, DATABASE_URL, SQS_ENDPOINT, SQS_QUEUE_URL, SQS_DLQ_URL, SQS_EVENTS_URL, AWS region/credentials, worker intervals). Read via `@nestjs/config`.
   - `src/domain/` — **pure TS, zero deps, no NestJS module** (classes only).
   - `src/application/application.module.ts` — stub `@Module({})`.
   - `src/infrastructure/persistence/persistence.module.ts` — stub.
   - `src/infrastructure/messaging/messaging.module.ts` — stub.
   - `src/interface/interface.module.ts` — stub.
   - `src/observability/` — **structured JSON logging** (pino) with `correlationId`/`messageId`/`transactionId`/`walletId`/`providerId` context, and a **metrics registry** (counters/gauges/histograms, in-process, no deps) exposed later. Provide `observability.module.ts` exporting a `Logger` and `Metrics` service. No sensitive/financial payloads in logs.

4. **Docker Compose** (`docker-compose.yml` + `.env.example`):
   - `postgres:16` (or 18) with healthcheck, volume, `DATABASE_URL` wiring.
   - `ministackorg/ministack` with the SQS queues for §10: `wager-transactions.fifo`, `wager-transactions-dlq.fifo` (DLQ + `maxReceiveCount` redrive policy), `wager-events.fifo`. Use an init script/`/_ministack` endpoint or a bootstrap step to create queues; document it.

5. **MikroORM config skeleton** (`mikro-orm.config.ts`) wired to `DATABASE_URL`, with migration path, so later tickets only add entities + migrations.

6. Verify the app boots: `bun install && bun run start:dev` (or `bun run start`) prints the Nest banner with no provider errors.

## Acceptance

- `bun install` succeeds; `bun run build` type-checks under strict mode.
- `docker compose up -d` brings up Postgres + MiniStack and creates the three queues.
- `bun run start` boots with no DI errors and logs JSON.
