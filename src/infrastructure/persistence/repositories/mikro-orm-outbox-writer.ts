import { Injectable } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/core";
import { OutboxWriter } from "../../../application/ports/outbox-writer";
import { IntegrationEvent } from "../../../domain/events";
import { OutboxMessage } from "../../../domain/outbox-message";
import { EntityManagerContext } from "../entity-manager-context";
import { OutboxMessageEntity } from "../entities/outbox-message.entity";

@Injectable()
export class MikroOrmOutboxWriter extends OutboxWriter {
  constructor(
    private readonly orm: MikroORM,
    private readonly ctx: EntityManagerContext,
  ) {
    super();
  }

  private get em() {
    return this.ctx.current() ?? this.orm.em.fork();
  }

  async enqueue(event: IntegrationEvent<unknown>): Promise<void> {
    const om = OutboxMessage.enqueue(event);
    this.em.create(OutboxMessageEntity, {
      id: om.id,
      aggregateId: om.aggregateId,
      eventType: om.eventType,
      payload: om.payload as Record<string, unknown>,
      occurredAt: om.occurredAt,
      attempts: om.attempts,
      nextAttemptAt: om.nextAttemptAt ?? null,
      publishedAt: om.publishedAt ?? null,
    });
  }
}
