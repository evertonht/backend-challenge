import { Injectable } from "@nestjs/common";
import { MoneyProps } from "../../domain/money";
import { Logger } from "../../observability/logger";
import { Metrics } from "../../observability/metrics";
import { LedgerEntryRepository } from "../ports/ledger-entry-repository";
import { WalletRepository } from "../ports/wallet-repository";

export interface ReconciliationResult {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

/**
 * Compares the wallet's stored balance against the balance reconstructed by
 * summing the ledger (§9). Divergences are signalled, logged and counted —
 * never silently corrected.
 */
@Injectable()
export class Reconcile {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly ledger: LedgerEntryRepository,
    private readonly metrics: Metrics,
    private readonly logger: Logger,
  ) {}

  async execute(walletId: string): Promise<ReconciliationResult | null> {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) {
      return null;
    }
    const calculated = await this.ledger.sum(walletId, wallet.currency);
    const checkedEntries = await this.ledger.count(walletId);
    const stored = wallet.balance;
    const difference = stored.subtract(calculated);
    const consistent = difference.isZero();

    if (!consistent) {
      this.metrics.counter("reconciliation_divergence", { walletId });
      this.logger.error(
        { walletId, storedBalance: stored.toJSON(), calculatedBalance: calculated.toJSON() },
        "wallet reconciliation divergence detected",
      );
    } else {
      this.metrics.counter("reconciliation_consistent", { walletId });
    }

    return {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries,
    };
  }
}
