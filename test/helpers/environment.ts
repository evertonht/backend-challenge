import { MikroORM } from "@mikro-orm/core";
import config from "../../src/infrastructure/persistence/mikro-orm.config";
import { EntityManagerContext } from "../../src/infrastructure/persistence/entity-manager-context";
import { MikroOrmUnitOfWork } from "../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { MikroOrmWalletRepository } from "../../src/infrastructure/persistence/repositories/mikro-orm-wallet.repository";
import { MikroOrmWagerTransactionRepository } from "../../src/infrastructure/persistence/repositories/mikro-orm-wager-transaction.repository";
import { MikroOrmLedgerEntryRepository } from "../../src/infrastructure/persistence/repositories/mikro-orm-ledger-entry.repository";
import { MikroOrmOutboxWriter } from "../../src/infrastructure/persistence/repositories/mikro-orm-outbox-writer";
import { MikroOrmInboxRepository } from "../../src/infrastructure/persistence/repositories/mikro-orm-inbox.repository";
import { Uuidv7IdGenerator } from "../../src/infrastructure/persistence/uuidv7-id-generator";
import { SystemClock } from "../../src/infrastructure/persistence/system-clock";
import { OpenWallet } from "../../src/application/use-cases/open-wallet";
import { SubmitTransaction } from "../../src/application/use-cases/submit-transaction";
import { RetryPendingReferences } from "../../src/application/use-cases/retry-pending-references";
import { Reconcile } from "../../src/application/use-cases/reconcile";
import { GetLedger } from "../../src/application/use-cases/get-ledger";
import { Metrics } from "../../src/observability/metrics";
import { Logger } from "../../src/observability/logger";

const silentLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  verbose: () => {},
  log: () => {},
  child: () => silentLogger,
} as unknown as Logger;

export interface Environment {
  orm: MikroORM;
  openWallet: OpenWallet;
  submitTransaction: SubmitTransaction;
  retryPendingReferences: RetryPendingReferences;
  reconcile: Reconcile;
  getLedger: GetLedger;
  close: () => Promise<void>;
}

export async function createEnvironment(): Promise<Environment> {
  const orm = await MikroORM.init({ ...config, connect: true });
  await orm.getMigrator().up();
  const ctx = new EntityManagerContext();
  const uow = new MikroOrmUnitOfWork(orm, ctx);
  const wallets = new MikroOrmWalletRepository(orm, ctx);
  const transactions = new MikroOrmWagerTransactionRepository(orm, ctx);
  const ledger = new MikroOrmLedgerEntryRepository(orm, ctx);
  const outbox = new MikroOrmOutboxWriter(orm, ctx);
  const ids = new Uuidv7IdGenerator();
  const inbox = new MikroOrmInboxRepository(orm, ctx, ids);
  const clock = new SystemClock();
  const metrics = new Metrics();

  const openWallet = new OpenWallet(uow, wallets, transactions, ledger, ids, clock);
  const submitTransaction = new SubmitTransaction(
    uow,
    wallets,
    transactions,
    ledger,
    outbox,
    inbox,
    ids,
    clock,
    metrics,
    silentLogger,
  );
  const retryPendingReferences = new RetryPendingReferences(
    uow,
    wallets,
    transactions,
    ledger,
    outbox,
    ids,
    clock,
    metrics,
    silentLogger,
  );
  const reconcile = new Reconcile(wallets, ledger, metrics, silentLogger);
  const getLedger = new GetLedger(ledger, wallets);

  return {
    orm,
    openWallet,
    submitTransaction,
    retryPendingReferences,
    reconcile,
    getLedger,
    close: () => orm.close(true),
  };
}

export async function resetDb(orm: MikroORM): Promise<void> {
  await orm.em
    .fork()
    .getConnection()
    .execute("TRUNCATE outbox_message, inbox_message, wallet_ledger_entry, wager_transaction, wallet CASCADE");
}

export function brl(amount: string): { amount: string; currency: string } {
  return { amount, currency: "BRL" };
}
