import { Module } from "@nestjs/common";
import { OpenWallet } from "./use-cases/open-wallet";
import { SubmitTransaction } from "./use-cases/submit-transaction";
import { GetWallet } from "./use-cases/get-wallet";
import { GetTransaction } from "./use-cases/get-transaction";
import { GetLedger } from "./use-cases/get-ledger";
import { Reconcile } from "./use-cases/reconcile";
import { RetryPendingReferences } from "./use-cases/retry-pending-references";

/**
 * Application layer: use cases + port seams. The port abstract classes are the
 * DI tokens; their concrete implementations are provided by the persistence
 * module (ticket 20) and resolved here through Nest's injector.
 */
@Module({
  providers: [OpenWallet, SubmitTransaction, GetWallet, GetTransaction, GetLedger, Reconcile, RetryPendingReferences],
  exports: [OpenWallet, SubmitTransaction, GetWallet, GetTransaction, GetLedger, Reconcile, RetryPendingReferences],
})
export class ApplicationModule {}
