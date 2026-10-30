Type: task
Status: resolved
Blocked by: 16

# Documentation (setup, run, commands)

## Context (read first)

- README §14 (documentation rubric), §4 (stack)
- `ARCHITECTURE.md` already documents decisions; don't rewrite it.

## Deliverables

1. A concise **setup/run section** (either extend the existing `README.md` or add `docs/running.md` and link it) covering:
   - prerequisites (Bun 1.x via mise, Docker).
   - `docker compose up -d`, migrations, `bun run start:dev`, health check URLs.
   - run unit / integration / concurrency tests.
   - how queues are created and the MiniStack reset endpoint.
2. Verify `ARCHITECTURE.md` and `CONTEXT.md` remain accurate against what was built; note any deviation explicitly (do not silently override decisions).

## Acceptance

- A fresh reader can start Postgres+MiniStack, run migrations, boot the API, and run all tests using only the documented commands.
