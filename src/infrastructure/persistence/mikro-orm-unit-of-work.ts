import { Injectable } from "@nestjs/common";
import { EntityManager, MikroORM } from "@mikro-orm/core";
import { UnitOfWork } from "../../application/ports/unit-of-work";
import { EntityManagerContext } from "./entity-manager-context";

/**
 * Transaction boundary backed by MikroORM `EntityManager.transactional`. Runs
 * the callback inside the transactional fork MikroORM provides (which carries
 * the driver transaction context), exposing that fork via AsyncLocalStorage so
 * repositories resolve it. MikroORM flushes the fork at commit.
 */
@Injectable()
export class MikroOrmUnitOfWork extends UnitOfWork {
  constructor(
    private readonly orm: MikroORM,
    private readonly ctx: EntityManagerContext,
  ) {
    super();
  }

  async transactional<T>(fn: () => Promise<T>): Promise<T> {
    const em = this.orm.em.fork();
    return em.transactional((txEm: EntityManager) => this.ctx.run(txEm, fn));
  }
}
