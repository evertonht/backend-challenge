import { Injectable } from "@nestjs/common";
import { WagerTransaction } from "../../domain/wager-transaction";
import { Wallet } from "../../domain/wallet";
import { WalletLedgerEntry } from "../../domain/ledger-entry";
import { WagerTransactionRejected, WalletBalanceChanged, EventContext } from "../../domain/events";
import { LedgerDirection, WagerTransactionStatus } from "../../domain/enums";
import { FailureCode } from "../../domain/failure-code";
import { ReversalWouldOverdrawError } from "../../domain/errors";
import { Logger } from "../../observability/logger";
import { Metrics } from "../../observability/metrics";
import { Clock } from "../ports/clock";
import { IdGenerator } from "../ports/id-generator";
import { LedgerEntryRepository } from "../ports/ledger-entry-repository";
import { OutboxWriter } from "../ports/outbox-writer";
import { UnitOfWork } from "../ports/unit-of-work";
import { WagerTransactionRepository } from "../ports/wager-transaction-repository";
import { WalletRepository } from "../ports/wallet-repository";

/**
 * Scheduled worker use case (§7.1 / ticket 10). Re-attempts `PENDING_REFERENCE`
 * reversals whose reference may have since arrived, applying them under the
 * wallet lock or, on exhaustion, rejecting them with `REFERENCE_NOT_FOUND`.
 */
@Injectable()
export class RetryPendingReferences {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly wallets: WalletRepository,
    private readonly transactions: WagerTransactionRepository,
    private readonly ledger: LedgerEntryRepository,
    private readonly outbox: OutboxWriter,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly metrics: Metrics,
    private readonly logger: Logger,
  ) {}

  /** Processes a batch of due pending references; returns how many were processed. */
  async execute(limit: number): Promise<number> {
    const now = this.clock.now();
    const due = await this.transactions.findDuePendingReferences(now, limit);
    for (const tx of due) {
      try {
        await this.processOne(tx, now);
      } catch (err) {
        this.logger.error({ transactionId: tx.id }, `pending-reference retry failed: ${String(err)}`);
      }
    }
    return due.length;
  }

  private async processOne(tx: WagerTransaction, now: Date): Promise<void> {
    await this.uow.transactional(async () => {
      const wallet = await this.wallets.findForUpdate(tx.walletId);
      if (!wallet) {
        return;
      }

      const ref = await this.transactions.findByProviderExternal(
        tx.providerId,
        tx.referenceExternalTransactionId as string,
      );

      if (!ref || ref.status !== WagerTransactionStatus.Processed) {
        // Reference still absent or not yet applied.
        if (tx.hasExhaustedReferenceAttempts(now)) {
          tx.reject(FailureCode.ReferenceNotFound);
          await this.transactions.save(tx);
          await this.outbox.enqueue(WagerTransactionRejected.from(tx, this.ctx(tx, now)));
          this.metrics.counter("pending_reference_exhausted");
        } else {
          tx.scheduleReferenceRetry(now);
          await this.transactions.save(tx);
          this.metrics.counter("pending_reference_retries");
        }
        return;
      }

      const code = tx.validateReference(ref);
      if (code) {
        tx.reject(code);
        await this.transactions.save(tx);
        await this.outbox.enqueue(WagerTransactionRejected.from(tx, this.ctx(tx, now)));
        return;
      }

      // At most one reversal per reference — prevents double credit/debit (§7.4).
      const alreadyReversed = await this.transactions.findProcessedReversal(
        tx.providerId,
        tx.referenceExternalTransactionId as string,
      );
      if (alreadyReversed) {
        tx.reject(FailureCode.ReferenceAlreadyReversed);
        await this.transactions.save(tx);
        await this.outbox.enqueue(WagerTransactionRejected.from(tx, this.ctx(tx, now)));
        return;
      }

      // Apply the reversal (REFUND credits; ROLLBACK inverts the reference).
      const entry = this.applyReversal(tx, wallet, ref, now);
      tx.markProcessed(ref.id, wallet.balance, now);

      await this.wallets.save(wallet);
      await this.transactions.save(tx);
      if (entry) {
        await this.ledger.append(entry);
        if (!entry.balanceBefore.equals(entry.balanceAfter)) {
          await this.outbox.enqueue(WalletBalanceChanged.from(wallet, entry, this.ctx(tx, now)));
        }
      }
      this.metrics.counter("pending_reference_resolved");
      this.logger.info({ transactionId: tx.id, walletId: wallet.id }, "pending reference applied");
    });
  }

  private applyReversal(
    tx: WagerTransaction,
    wallet: Wallet,
    ref: WagerTransaction,
    now: Date,
  ): WalletLedgerEntry | undefined {
    const direction = tx.ledgerDirectionFor(ref);
    if (direction === LedgerDirection.Debit) {
      if (wallet.balance.isLessThan(tx.money)) {
        throw new ReversalWouldOverdrawError();
      }
      return wallet.debit({ entryId: this.ids.nextId(), transactionId: tx.id, money: tx.money, at: now });
    }
    return wallet.credit({ entryId: this.ids.nextId(), transactionId: tx.id, money: tx.money, at: now });
  }

  private ctx(tx: WagerTransaction, now: Date): EventContext {
    return { eventId: this.ids.nextId(), correlationId: `worker:${tx.id}`, occurredAt: now };
  }
}
