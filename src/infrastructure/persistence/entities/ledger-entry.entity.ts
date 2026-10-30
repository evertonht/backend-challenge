import { Check, Entity, Index, PrimaryKey, Property, Unique } from "@mikro-orm/core";

const ARITHMETIC_CHECK =
  "(direction = 'CREDIT' AND balance_after = balance_before + amount) OR (direction = 'DEBIT' AND balance_after = balance_before - amount)";

@Entity({ tableName: "wallet_ledger_entry" })
@Unique({ properties: ["transactionId"] })
@Index({ properties: ["walletId", "createdAt", "id"] })
@Check({ expression: ARITHMETIC_CHECK })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid" })
  walletId!: string;

  @Property({ type: "uuid" })
  transactionId!: string;

  @Property({ columnType: "text" })
  direction!: string;

  @Property({ type: "decimal", columnType: "numeric(20,2)" })
  amount!: string;

  @Property({ columnType: "text" })
  currency!: string;

  @Property({ type: "decimal", columnType: "numeric(20,2)" })
  balanceBefore!: string;

  @Property({ type: "decimal", columnType: "numeric(20,2)" })
  balanceAfter!: string;

  @Property()
  createdAt!: Date;
}
