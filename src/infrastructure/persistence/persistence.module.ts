import { Global, Module } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/core";
import { Clock } from "../../application/ports/clock";
import { IdGenerator } from "../../application/ports/id-generator";
import { InboxRepository } from "../../application/ports/inbox-repository";
import { LedgerEntryRepository } from "../../application/ports/ledger-entry-repository";
import { OutboxWriter } from "../../application/ports/outbox-writer";
import { UnitOfWork } from "../../application/ports/unit-of-work";
import { WalletRepository } from "../../application/ports/wallet-repository";
import { WagerTransactionRepository } from "../../application/ports/wager-transaction-repository";
import config from "./mikro-orm.config";
import { EntityManagerContext } from "./entity-manager-context";
import { MikroOrmUnitOfWork } from "./mikro-orm-unit-of-work";
import { SystemClock } from "./system-clock";
import { Uuidv7IdGenerator } from "./uuidv7-id-generator";
import { MikroOrmWalletRepository } from "./repositories/mikro-orm-wallet.repository";
import { MikroOrmWagerTransactionRepository } from "./repositories/mikro-orm-wager-transaction.repository";
import { MikroOrmLedgerEntryRepository } from "./repositories/mikro-orm-ledger-entry.repository";
import { MikroOrmOutboxWriter } from "./repositories/mikro-orm-outbox-writer";
import { MikroOrmInboxRepository } from "./repositories/mikro-orm-inbox.repository";

/**
 * Persistence adapters (ticket 20). Provides the MikroORM instance and binds the
 * application port abstract classes to their implementations. `@Global` so the
 * application/interface layers resolve the ports without importing this module.
 */
@Global()
@Module({
  providers: [
    EntityManagerContext,
    {
      provide: MikroORM,
      useFactory: async (): Promise<MikroORM> => {
        // `connect: false` keeps boot non-fatal when PostgreSQL is down, so the
        // readiness health check can report 503 instead of the process crashing.
        // Migrations are applied explicitly (`bun run migration:up`) or by the
        // integration test harness.
        return MikroORM.init({ ...config, connect: false });
      },
    },
    { provide: IdGenerator, useClass: Uuidv7IdGenerator },
    { provide: Clock, useClass: SystemClock },
    { provide: UnitOfWork, useClass: MikroOrmUnitOfWork },
    { provide: WalletRepository, useClass: MikroOrmWalletRepository },
    { provide: WagerTransactionRepository, useClass: MikroOrmWagerTransactionRepository },
    { provide: LedgerEntryRepository, useClass: MikroOrmLedgerEntryRepository },
    { provide: OutboxWriter, useClass: MikroOrmOutboxWriter },
    { provide: InboxRepository, useClass: MikroOrmInboxRepository },
  ],
  exports: [
    MikroORM,
    EntityManagerContext,
    IdGenerator,
    Clock,
    UnitOfWork,
    WalletRepository,
    WagerTransactionRepository,
    LedgerEntryRepository,
    OutboxWriter,
    InboxRepository,
  ],
})
export class PersistenceModule {}
