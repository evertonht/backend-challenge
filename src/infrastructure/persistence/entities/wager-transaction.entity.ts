import { Entity, Index, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "wager_transaction" })
@Unique({ properties: ["idempotencyKey"] })
@Unique({ properties: ["providerId", "externalTransactionId"] })
@Index({ properties: ["walletId"] })
@Index({ properties: ["status"] })
@Index({ properties: ["walletId", "createdAt"] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ columnType: "text" })
  providerId!: string;

  @Property({ columnType: "text" })
  externalTransactionId!: string;

  @Property({ columnType: "text" })
  idempotencyKey!: string;

  @Property({ columnType: "text" })
  payloadHash!: string;

  @Property({ type: "uuid" })
  walletId!: string;

  @Property({ columnType: "text" })
  playerId!: string;

  @Property({ columnType: "text" })
  roundId!: string;

  @Property({ columnType: "text" })
  gameId!: string;

  @Property({ columnType: "text" })
  kind!: string;

  @Property({ type: "decimal", columnType: "numeric(20,2)" })
  amount!: string;

  @Property({ columnType: "text" })
  currency!: string;

  @Property({ columnType: "text", nullable: true })
  referenceExternalTransactionId?: string | null;

  @Property({ type: "uuid", nullable: true })
  referenceTransactionId?: string | null;

  @Property({ columnType: "text" })
  status!: string;

  @Property({ columnType: "text", nullable: true })
  failureCode?: string | null;

  @Property({ type: "decimal", columnType: "numeric(20,2)", nullable: true })
  balanceAfter?: string | null;

  @Property({ type: "integer", default: 0 })
  attempts!: number;

  @Property({ nullable: true })
  nextAttemptAt?: Date | null;

  @Property()
  createdAt!: Date;

  @Property({ nullable: true })
  processedAt?: Date | null;
}
