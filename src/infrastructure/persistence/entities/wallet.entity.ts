import { Check, Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "wallet" })
@Unique({ properties: ["playerId", "currency"] })
@Check({ expression: "balance >= 0" })
export class WalletEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ columnType: "text" })
  playerId!: string;

  @Property({ columnType: "text" })
  currency!: string;

  @Property({ type: "decimal", columnType: "numeric(20,2)" })
  balance!: string;

  @Property({ type: "integer" })
  version!: number;

  @Property()
  createdAt!: Date;

  @Property({ onUpdate: () => new Date() })
  updatedAt!: Date;
}
