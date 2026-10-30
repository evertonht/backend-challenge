import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "outbox_message" })
@Index({ properties: ["nextAttemptAt"], expression: "where published_at is null" })
export class OutboxMessageEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid" })
  aggregateId!: string;

  @Property({ columnType: "text" })
  eventType!: string;

  @Property({ type: "json" })
  payload!: Record<string, unknown>;

  @Property()
  occurredAt!: Date;

  @Property({ type: "integer", default: 0 })
  attempts!: number;

  @Property({ nullable: true })
  nextAttemptAt?: Date | null;

  @Property({ nullable: true })
  publishedAt?: Date | null;
}
