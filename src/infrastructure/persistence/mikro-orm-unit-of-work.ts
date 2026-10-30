import { EntityManager, MikroORM } from "@mikro-orm/core";
import { UnitOfWork } from "../../application/ports/unit-of-work";
import { EntityManagerContext } from "./entity-manager-context";

/**
 * Transaction boundary backed by MikroORM `EntityManager.transactional`. Forks a
 * fresh EntityManager per transaction (isolation) and runs the callback inside
 * an AsyncLocalStorage context so repositories resolve that same `em`.
 */
export class MikroOrmUnitOfWork extends UnitOfWork {
  constructor(
    private readonly orm: MikroORM,
    private readonly ctx: EntityManagerContext,
  ) {
    super();
  }

  async transactional<T>(fn: () => Promise<T>): Promise<T> {
    const em = this.orm.em.fork();
    return em.transactional(() => this.ctx.run(em, fn));
  }
}
