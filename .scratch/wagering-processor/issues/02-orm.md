Type: grilling
Status: resolved

## Question

MikroORM or TypeORM — which ORM should the project adopt? `README.md` §4 prefers MikroORM (explicit Unit of Work, Identity Map, `EntityManager.transactional()`, `LockMode`) and accepts TypeORM; Prisma is out of scope.

The resolution must justify the choice against: aggregate-oriented writes, optimistic/pessimistic locking support, custom `Money` type mapping, versioned + reversible migrations, and Bun compatibility.

## Answer

**MikroORM.** (Confirmed by the user, 2026-10-30.)

- README §4 states MikroORM as preferred; TypeORM accepted, Prisma out.
- MikroORM's explicit Unit of Work + Identity Map + `EntityManager.transactional()` + `LockMode` map one-to-one onto the challenge's aggregate/transactional design — §11 atomicity across wallet + ledger + inbox + outbox, and §8 per-wallet locking (ticket 04).
- TypeORM's global-manager model buys nothing here and costs more discipline to keep ORM concerns out of the pure domain (§6.1).
- Custom `Money` type (ticket 03) and versioned/reversible migrations (ticket 05) are supported by both; the choice does not force a different answer there.
- Bun: neither ORM is Bun-first-class; verify MikroORM-on-Bun with a build-time spike (§4 mandates Bun, so this is verification, not a deciding factor).
- Build-time follow-through: document this choice, the `Money` mapping, and the transactional strategy in `ARCHITECTURE.md` (§4, §8).
