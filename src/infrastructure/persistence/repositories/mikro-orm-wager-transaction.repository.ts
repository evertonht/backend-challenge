import { LockMode, MikroORM } from "@mikro-orm/core";
import { WagerTransactionRepository } from "../../../application/ports/wager-transaction-repository";
import { WagerTransactionStatus } from "../../../domain/enums";
import { WagerTransaction } from "../../../domain/wager-transaction";
import { EntityManagerContext } from "../entity-manager-context";
import { WagerTransactionEntity } from "../entities/wager-transaction.entity";
import { txToData, txToDomain } from "../mappers";

export class MikroOrmWagerTransactionRepository extends WagerTransactionRepository {
  constructor(
    private readonly orm: MikroORM,
    private readonly ctx: EntityManagerContext,
  ) {
    super();
  }

  private get em() {
    return this.ctx.current() ?? this.orm.em;
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
    const data = txToData(tx);
    const managed = this.em.getUnitOfWork().getById(WagerTransactionEntity.name, tx.id) as
      | WagerTransactionEntity
      | undefined;
    if (managed) {
      this.em.assign(managed, data as never);
    } else {
      this.em.create(WagerTransactionEntity, data as never);
    }
  }

  async findDuePendingReferences(now: Date, limit: number): Promise<WagerTransaction[]> {
    const entities = await this.em.find(
      WagerTransactionEntity,
      { status: WagerTransactionStatus.PendingReference, nextAttemptAt: { $lte: now } },
      { limit, orderBy: { nextAttemptAt: "ASC" }, lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE },
    );
    return entities.map(txToDomain);
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
