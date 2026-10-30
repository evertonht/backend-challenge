import { LedgerDirection, WagerTransactionKind, WagerTransactionStatus } from "../../domain/enums";
import { FailureCode } from "../../domain/failure-code";
import { InboxMessage } from "../../domain/inbox-message";
import { WalletLedgerEntry } from "../../domain/ledger-entry";
import { OutboxMessage } from "../../domain/outbox-message";
import { Wallet } from "../../domain/wallet";
import { WagerTransaction } from "../../domain/wager-transaction";
import { InboxMessageEntity } from "./entities/inbox-message.entity";
import { WalletLedgerEntryEntity } from "./entities/ledger-entry.entity";
import { OutboxMessageEntity } from "./entities/outbox-message.entity";
import { WagerTransactionEntity } from "./entities/wager-transaction.entity";
import { WalletEntity } from "./entities/wallet.entity";

// ---- Wallet ----
export function walletToDomain(e: WalletEntity): Wallet {
  return Wallet.rehydrate({
    id: e.id,
    playerId: e.playerId,
    currency: e.currency,
    balance: { amount: e.balance, currency: e.currency },
    version: e.version,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  });
}

export function walletToData(w: Wallet): Record<string, unknown> {
  return {
    playerId: w.playerId,
    currency: w.currency,
    balance: w.balance.toString(),
    version: w.version,
    updatedAt: w.updatedAt,
  };
}

// ---- WagerTransaction ----
export function txToDomain(e: WagerTransactionEntity): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: e.id,
    providerId: e.providerId,
    externalTransactionId: e.externalTransactionId,
    idempotencyKey: e.idempotencyKey,
    payloadHash: e.payloadHash,
    walletId: e.walletId,
    playerId: e.playerId,
    roundId: e.roundId,
    gameId: e.gameId,
    kind: e.kind as WagerTransactionKind,
    money: { amount: e.amount, currency: e.currency },
    referenceExternalTransactionId: e.referenceExternalTransactionId ?? undefined,
    createdAt: e.createdAt,
    status: e.status as WagerTransactionStatus,
    referenceTransactionId: e.referenceTransactionId ?? undefined,
    failureCode: (e.failureCode as FailureCode | null) ?? undefined,
    processedAt: e.processedAt ?? undefined,
    attempts: e.attempts,
    nextAttemptAt: e.nextAttemptAt ?? undefined,
    balanceAfter: e.balanceAfter != null ? { amount: e.balanceAfter, currency: e.currency } : undefined,
  });
}

export function txToData(tx: WagerTransaction): Record<string, unknown> {
  return {
    id: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    idempotencyKey: tx.idempotencyKey,
    payloadHash: tx.payloadHash,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    amount: tx.money.toString(),
    currency: tx.money.currency,
    referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
    referenceTransactionId: tx.referenceTransactionId ?? null,
    status: tx.status,
    failureCode: tx.failureCode ?? null,
    balanceAfter: tx.balanceAfter ? tx.balanceAfter.toString() : null,
    attempts: tx.attempts,
    nextAttemptAt: tx.nextAttemptAt ?? null,
    createdAt: tx.createdAt,
    processedAt: tx.processedAt ?? null,
  };
}

// ---- Ledger entry ----
export function entryToDomain(e: WalletLedgerEntryEntity): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: e.id,
    walletId: e.walletId,
    transactionId: e.transactionId,
    direction: e.direction as LedgerDirection,
    money: { amount: e.amount, currency: e.currency },
    balanceBefore: { amount: e.balanceBefore, currency: e.currency },
    balanceAfter: { amount: e.balanceAfter, currency: e.currency },
    createdAt: e.createdAt,
  });
}

export function entryToData(entry: WalletLedgerEntry): Record<string, unknown> {
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    direction: entry.direction,
    amount: entry.money.toString(),
    currency: entry.money.currency,
    balanceBefore: entry.balanceBefore.toString(),
    balanceAfter: entry.balanceAfter.toString(),
    createdAt: entry.createdAt,
  };
}

// ---- Inbox ----
export function inboxToDomain(e: InboxMessageEntity): InboxMessage {
  return InboxMessage.rehydrate({
    messageId: e.messageId,
    consumerName: e.consumerName,
    payloadHash: e.payloadHash,
    receivedAt: e.receivedAt,
    processedAt: e.processedAt ?? undefined,
  });
}

// ---- Outbox ----
export function outboxToDomain(e: OutboxMessageEntity): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: e.id,
    aggregateId: e.aggregateId,
    eventType: e.eventType,
    payload: e.payload,
    occurredAt: e.occurredAt,
    attempts: e.attempts,
    nextAttemptAt: e.nextAttemptAt ?? undefined,
    publishedAt: e.publishedAt ?? undefined,
  });
}
