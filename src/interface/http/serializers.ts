import { WagerTransaction } from "../../domain/wager-transaction";
import { Wallet } from "../../domain/wallet";
import { WalletLedgerEntry } from "../../domain/ledger-entry";

export function walletView(wallet: Wallet) {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: { amount: wallet.balance.toString(), currency: wallet.currency },
    version: wallet.version,
  };
}

export function ledgerEntryView(entry: WalletLedgerEntry) {
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    direction: entry.direction,
    money: entry.money.toJSON(),
    balanceBefore: entry.balanceBefore.toJSON(),
    balanceAfter: entry.balanceAfter.toJSON(),
    createdAt: entry.createdAt.toISOString(),
  };
}

export function transactionView(tx: WagerTransaction) {
  return {
    id: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    money: tx.money.toJSON(),
    referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
    status: tx.status,
    failureCode: tx.failureCode ?? null,
    balanceAfter: tx.balanceAfter ? tx.balanceAfter.toJSON() : null,
    createdAt: tx.createdAt.toISOString(),
    processedAt: tx.processedAt ? tx.processedAt.toISOString() : null,
  };
}
