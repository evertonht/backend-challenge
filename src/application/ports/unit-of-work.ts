/**
 * Transaction boundary (§5 / §11). `transactional(fn)` runs `fn` inside a single
 * SQL transaction; every repository/enqueue call made within `fn` participates
 * in that same transaction. The implementation is MikroORM's
 * `EntityManager.transactional` (ticket 20).
 */
export abstract class UnitOfWork {
  abstract transactional<T>(fn: () => Promise<T>): Promise<T>;
}
