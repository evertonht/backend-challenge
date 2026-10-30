import { Injectable } from "@nestjs/common";
import { WagerTransaction } from "../../domain/wager-transaction";
import { Wallet } from "../../domain/wallet";
import { WalletLedgerEntry } from "../../domain/ledger-entry";
import { InboxMessage } from "../../domain/inbox-message";
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
  WalletBalanceChanged,
  EventContext,
} from "../../domain/events";
import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from "../../domain/enums";
import { FailureCode } from "../../domain/failure-code";
import {
  BusinessRuleError,
  IdempotencyConflictError,
  ReversalWouldOverdrawError,
  WalletNotFoundError,
} from "../../domain/errors";
import { Money, MoneyProps } from "../../domain/money";
import { Logger } from "../../observability/logger";
import { Metrics } from "../../observability/metrics";
import { Clock } from "../ports/clock";
import { IdGenerator } from "../ports/id-generator";
import { InboxRepository } from "../ports/inbox-repository";
import { LedgerEntryRepository } from "../ports/ledger-entry-repository";
import { OutboxWriter } from "../ports/outbox-writer";
import { UnitOfWork } from "../ports/unit-of-work";
import { WagerTransactionRepository } from "../ports/wager-transaction-repository";
import { WalletRepository } from "../ports/wallet-repository";

export interface SubmitTransactionCommand {
  idempotencyKey: string;
  payloadHash: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  correlationId: string;
  /** Set when the input is SQS — drives persistent inbox dedup. */
  consumerName?: string;
  messageId?: string;
}

export interface SubmitTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  balance?: MoneyProps;
  idempotentReplay: boolean;
}

type ReferenceResolution =
  | { kind: "resolved"; reference: WagerTransaction }
  | { kind: "pending" }
  | { kind: "rejected"; code: FailureCode };

/**
 * The single business path for both HTTP and SQS (§10). Runs inside one
 * transaction: inbox record, idempotency resolution, wallet lock, financial
 * change, ledger entry, transaction status, and outbox events are atomic (§11).
 */
@Injectable()
export class SubmitTransaction {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly wallets: WalletRepository,
    private readonly transactions: WagerTransactionRepository,
    private readonly ledger: LedgerEntryRepository,
    private readonly outbox: OutboxWriter,
    private readonly inbox: InboxRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly metrics: Metrics,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: SubmitTransactionCommand): Promise<SubmitTransactionResult> {
    const started = performance.now();
    try {
      return await this.uow.transactional(async () => {
        const now = this.clock.now();

        // 1. Inbox record (SQS path) — inserted in the same tx; UNIQUE(consumer, messageId)
        //    guarantees at-most-once even under concurrent redelivery (a violation aborts
        //    the tx and the consumer treats it as a transient redelivery).
        if (cmd.consumerName && cmd.messageId) {
          await this.inbox.record(
            InboxMessage.receive({
              messageId: cmd.messageId,
              consumerName: cmd.consumerName,
              payloadHash: cmd.payloadHash,
              receivedAt: now,
            }),
          );
        }

        // 2. Wallet lock — the concurrency unit (§5). Locking first serializes
        //    same-wallet (and thus same-idempotency-key) requests, so the
        //    idempotency check below is race-safe under concurrent redelivery.
        const wallet = await this.wallets.findForUpdate(cmd.walletId);
        if (!wallet) {
          throw new WalletNotFoundError(cmd.walletId);
        }

        // 3. Idempotency — inside the wallet lock.
        const existing = await this.transactions.findByIdempotencyKey(cmd.idempotencyKey);
        if (existing) {
          if (!existing.matchesPayload(cmd.payloadHash)) {
            throw new IdempotencyConflictError();
          }
          this.metrics.counter("idempotent_replays");
          return this.replayResult(existing);
        }

        const tx = WagerTransaction.create({
          id: this.ids.nextId(),
          providerId: cmd.providerId,
          externalTransactionId: cmd.externalTransactionId,
          idempotencyKey: cmd.idempotencyKey,
          payloadHash: cmd.payloadHash,
          walletId: cmd.walletId,
          playerId: cmd.playerId,
          roundId: cmd.roundId,
          gameId: cmd.gameId,
          kind: cmd.kind,
          money: cmd.money,
          referenceExternalTransactionId: cmd.referenceExternalTransactionId,
          createdAt: now,
        });

        // 4. Resolve reference for reversals.
        let reference: WagerTransaction | undefined;
        if (tx.requiresReference()) {
          const resolution = await this.resolveReference(tx, cmd);
          if (resolution.kind === "pending") {
            return await this.parkPendingReference(tx, cmd, now);
          }
          if (resolution.kind === "rejected") {
            return await this.reject(tx, resolution.code, cmd, now);
          }
          reference = resolution.reference;
        }

        // 5. Apply the financial change.
        return await this.apply(tx, wallet, reference, cmd, now);
      });
    } finally {
      this.metrics.histogram("processing_latency_ms", performance.now() - started);
    }
  }

  private async resolveReference(tx: WagerTransaction, cmd: SubmitTransactionCommand): Promise<ReferenceResolution> {
    const externalId = tx.referenceExternalTransactionId as string;
    const ref = await this.transactions.findByProviderExternal(cmd.providerId, externalId);
    if (!ref) {
      // Not arrived yet (§7.8) — park and retry via the scheduled worker.
      return { kind: "pending" };
    }

    if (ref.status !== WagerTransactionStatus.Processed) {
      if (ref.isTerminal()) {
        return { kind: "rejected", code: FailureCode.ReferenceNotProcessed };
      }
      // Reference exists but is not applied yet — wait for it (§7 out-of-order).
      return { kind: "pending" };
    }

    const validationCode = tx.validateReference(ref);
    if (validationCode) {
      return { kind: "rejected", code: validationCode };
    }

    // At most one reversal per reference — prevents double credit/debit (§7.4).
    const alreadyReversed = await this.transactions.findProcessedReversal(cmd.providerId, externalId);
    if (alreadyReversed) {
      return { kind: "rejected", code: FailureCode.ReferenceAlreadyReversed };
    }

    return { kind: "resolved", reference: ref };
  }

  private async apply(
    tx: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransaction | undefined,
    cmd: SubmitTransactionCommand,
    now: Date,
  ): Promise<SubmitTransactionResult> {
    let entry: WalletLedgerEntry | undefined;

    try {
      switch (tx.kind) {
        case WagerTransactionKind.Bet:
          entry = wallet.debit({ entryId: this.ids.nextId(), transactionId: tx.id, money: tx.money, at: now });
          break;
        case WagerTransactionKind.Win:
        case WagerTransactionKind.Refund:
          entry = wallet.credit({ entryId: this.ids.nextId(), transactionId: tx.id, money: tx.money, at: now });
          break;
        case WagerTransactionKind.Loss:
          break; // no balance change, no ledger entry (§7)
        case WagerTransactionKind.Rollback: {
          const direction = tx.ledgerDirectionFor(reference);
          if (direction === LedgerDirection.Debit) {
            if (wallet.balance.isLessThan(tx.money)) {
              throw new ReversalWouldOverdrawError();
            }
            entry = wallet.debit({ entryId: this.ids.nextId(), transactionId: tx.id, money: tx.money, at: now });
          } else {
            entry = wallet.credit({ entryId: this.ids.nextId(), transactionId: tx.id, money: tx.money, at: now });
          }
          break;
        }
        case WagerTransactionKind.Opening:
          throw new BusinessRuleError(FailureCode.InvalidPayload, "OPENING is not submittable");
      }
    } catch (err) {
      if (err instanceof BusinessRuleError) {
        return this.reject(tx, err.code, cmd, now);
      }
      throw err;
    }

    const balance = wallet.balance;
    tx.markProcessed(reference?.id, balance, now);

    await this.wallets.save(wallet);
    await this.transactions.save(tx);
    if (entry) {
      await this.ledger.append(entry);
    }

    // Each event gets its own fresh eventId (the outbox PK), so two events from
    // the same operation never collide.
    await this.outbox.enqueue(
      WagerTransactionProcessed.from(tx, tx.affectsBalance() ? balance : null, this.eventContext(cmd, now)),
    );
    if (entry && !entry.balanceBefore.equals(entry.balanceAfter)) {
      await this.outbox.enqueue(WalletBalanceChanged.from(wallet, entry, this.eventContext(cmd, now)));
    }

    this.metrics.counter("transactions", { status: "PROCESSED", kind: tx.kind });
    this.logger.info(
      { correlationId: cmd.correlationId, transactionId: tx.id, walletId: wallet.id, providerId: cmd.providerId },
      "transaction processed",
    );

    return {
      transactionId: tx.id,
      status: tx.status,
      balance: balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async parkPendingReference(
    tx: WagerTransaction,
    cmd: SubmitTransactionCommand,
    now: Date,
  ): Promise<SubmitTransactionResult> {
    tx.markPendingReference(now);
    await this.transactions.save(tx);
    await this.outbox.enqueue(WagerTransactionPendingReference.from(tx, this.eventContext(cmd, now)));
    this.metrics.counter("transactions", { status: "PENDING_REFERENCE", kind: tx.kind });
    return { transactionId: tx.id, status: tx.status, idempotentReplay: false };
  }

  private async reject(
    tx: WagerTransaction,
    code: FailureCode,
    cmd: SubmitTransactionCommand,
    now: Date,
  ): Promise<SubmitTransactionResult> {
    tx.reject(code);
    await this.transactions.save(tx);
    await this.outbox.enqueue(WagerTransactionRejected.from(tx, this.eventContext(cmd, now)));
    this.metrics.counter("transactions", { status: "REJECTED", kind: tx.kind });
    this.logger.info(
      { correlationId: cmd.correlationId, transactionId: tx.id, failureCode: code, providerId: cmd.providerId },
      "transaction rejected",
    );
    return { transactionId: tx.id, status: tx.status, failureCode: code, idempotentReplay: false };
  }

  private replayResult(existing: WagerTransaction): SubmitTransactionResult {
    return {
      transactionId: existing.id,
      status: existing.status,
      failureCode: existing.failureCode,
      balance: existing.balanceAfter?.toJSON(),
      idempotentReplay: true,
    };
  }

  private eventContext(cmd: SubmitTransactionCommand, now: Date): EventContext {
    return {
      eventId: this.ids.nextId(),
      correlationId: cmd.correlationId,
      causationId: cmd.messageId,
      occurredAt: now,
    };
  }
}
