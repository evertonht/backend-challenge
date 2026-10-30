import { AsyncLocalStorage } from "node:async_hooks";
import type { EntityManager } from "@mikro-orm/core";

/**
 * Holds the current transactional EntityManager for the duration of a
 * `UnitOfWork.transactional` call, so stateless singleton repositories resolve
 * the same `em` as the transaction they run inside.
 */
export class EntityManagerContext {
  private readonly storage = new AsyncLocalStorage<EntityManager>();

  run<T>(em: EntityManager, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(em, fn);
  }

  current(): EntityManager | undefined {
    return this.storage.getStore();
  }
}
