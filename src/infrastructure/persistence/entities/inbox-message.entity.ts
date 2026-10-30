import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "inbox_message" })
@Unique({ properties: ["consumerName", "messageId"] })
export class InboxMessageEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ columnType: "text" })
  messageId!: string;

  @Property({ columnType: "text" })
  consumerName!: string;

  @Property({ columnType: "text" })
  payloadHash!: string;

  @Property()
  receivedAt!: Date;

  @Property({ nullable: true })
  processedAt?: Date | null;
}
