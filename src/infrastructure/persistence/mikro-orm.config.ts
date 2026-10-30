import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { InboxMessageEntity } from "./entities/inbox-message.entity";
import { WalletLedgerEntryEntity } from "./entities/ledger-entry.entity";
import { OutboxMessageEntity } from "./entities/outbox-message.entity";
import { WagerTransactionEntity } from "./entities/wager-transaction.entity";
import { WalletEntity } from "./entities/wallet.entity";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://wagering:wagering@localhost:5432/wagering";

export default defineConfig({
  clientUrl: databaseUrl,
  entities: [WalletEntity, WagerTransactionEntity, WalletLedgerEntryEntity, InboxMessageEntity, OutboxMessageEntity],
  extensions: [Migrator],
  migrations: {
    path: "./src/infrastructure/persistence/migrations",
    glob: "!(*.d).{js,ts}",
    emit: "ts",
  },
  // Money is exact decimal; never let the driver coerce numeric to a JS number.
  // `numeric` columns are mapped to `string` (DecimalType) by default.
});
