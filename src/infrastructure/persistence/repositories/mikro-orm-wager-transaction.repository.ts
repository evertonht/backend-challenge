import { Injectable } from "@nestjs/common";
import { LockMode, MikroORM } from "@mikro-orm/core";
import { WagerTransactionRepository } from "../../../application/ports/wager-transaction-repository";
import { WagerTransactionStatus } from "../../../domain/enums";
import { WagerTransaction } from "../../../domain/wager-transaction";
import { EntityManagerContext } from "../entity-manager-context";
import { WagerTransactionEntity } from "../entities/wager-transaction.entity";
import { txToData, txToDomain } from "../mappers";

@Injectable()
export class MikroOrmWagerTransactionRepository extends WagerTransactionRepository {
  constructor(
    private readonly orm: MikroORM,
    private readonly ctx: EntityManagerContext,
  ) {
    super();
  }

  private get em() {
    return this.ctx.current() ?? this.orm.em.fork();
  }

  async findById(id: string): Promise<WagerTransaction | null> {
    const e = await this.em.findOne(WagerTransactionEntity, id);
    return e ? txToDomain(e) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const e = await this.em.findOne(WagerTransactionEntity, { idempotencyKey });
    return e ? txToDomain(e) : null;
  }

  async findByProviderExternal(providerId: string, externalTransactionId: string): Promise<WagerTransaction | null> {
    const e = await this.em.findOne(WagerTransactionEntity, { providerId, externalTransactionId });
    return e ? txToDomain(e) : null;
  }

  async save(tx: WagerTransaction): Promise<void> {
    await this.em.upsert(WagerTransactionEntity, txToData(tx) as never);
  }

  async findDuePendingReferences(now: Date, limit: number): Promise<WagerTransaction[]> {
    // Claim due rows with SKIP LOCKED in a short transaction so concurrent
    // workers each take distinct rows; bump next_attempt_at to hide them.
    const em = this.orm.em.fork();
    return em.transactional(async (txEm) => {
      const entities = await txEm.find(
        WagerTransactionEntity,
        { status: WagerTransactionStatus.PendingReference, nextAttemptAt: { $lte: now } },
        { limit, orderBy: { nextAttemptAt: "ASC" }, lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE },
      );
      const future = new Date(now.getTime() + 30_000);
      for (const e of entities) {
        txEm.assign(e, { nextAttemptAt: future });
      }
      return entities.map(txToDomain);
    });
  }

  async findProcessedReversal(
    providerId: string,
    referenceExternalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const e = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      referenceExternalTransactionId,
      status: WagerTransactionStatus.Processed,
      kind: { $in: ["REFUND", "ROLLBACK"] },
    });
    return e ? txToDomain(e) : null;
  }
}
