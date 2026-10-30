import { Injectable } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/core";
import { InboxRepository } from "../../../application/ports/inbox-repository";
import { InboxMessage } from "../../../domain/inbox-message";
import { IdGenerator } from "../../../application/ports/id-generator";
import { EntityManagerContext } from "../entity-manager-context";
import { InboxMessageEntity } from "../entities/inbox-message.entity";

@Injectable()
export class MikroOrmInboxRepository extends InboxRepository {
  constructor(
    private readonly orm: MikroORM,
    private readonly ctx: EntityManagerContext,
    private readonly ids: IdGenerator,
  ) {
    super();
  }

  private get em() {
    return this.ctx.current() ?? this.orm.em.fork();
  }

  async record(message: InboxMessage): Promise<void> {
    this.em.create(InboxMessageEntity, {
      id: this.ids.nextId(),
      messageId: message.messageId,
      consumerName: message.consumerName,
      payloadHash: message.payloadHash,
      receivedAt: message.receivedAt,
      processedAt: message.processedAt ?? null,
    });
  }

  async exists(consumerName: string, messageId: string): Promise<boolean> {
    const found = await this.em.findOne(InboxMessageEntity, { consumerName, messageId }, { fields: ["id"] });
    return found !== null;
  }
}
