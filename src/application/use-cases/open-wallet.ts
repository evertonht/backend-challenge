import { Injectable } from "@nestjs/common";
import { UniqueConstraintViolationException } from "@mikro-orm/core";
import { Wallet } from "../../domain/wallet";
import { WagerTransaction } from "../../domain/wager-transaction";
import { WalletLedgerEntry } from "../../domain/ledger-entry";
import { LedgerDirection } from "../../domain/enums";
import { DuplicateWalletError } from "../../domain/errors";
import { Money, MoneyProps } from "../../domain/money";
import { Clock } from "../ports/clock";
import { IdGenerator } from "../ports/id-generator";
import { LedgerEntryRepository } from "../ports/ledger-entry-repository";
import { UnitOfWork } from "../ports/unit-of-work";
import { WagerTransactionRepository } from "../ports/wager-transaction-repository";
import { WalletRepository } from "../ports/wallet-repository";

export interface OpenWalletCommand {
  playerId: string;
  initialBalance: Money;
}

export interface OpenWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

/**
 * Creates a wallet for a player. When the initial balance is positive it also
 * writes an internal OPENING `WagerTransaction` + `CREDIT` ledger entry in the
 * same SQL transaction (§9), so the ledger is complete from the first cent.
 */
@Injectable()
export class OpenWallet {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly wallets: WalletRepository,
    private readonly transactions: WagerTransactionRepository,
    private readonly ledger: LedgerEntryRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: OpenWalletCommand): Promise<OpenWalletResult> {
    try {
      return await this.uow.transactional(async () => {
        const existing = await this.wallets.findByPlayerCurrency(command.playerId, command.initialBalance.currency);
        if (existing) {
          throw new DuplicateWalletError(command.playerId, command.initialBalance.currency);
        }

      const id = this.ids.nextId();
      const wallet = Wallet.open({ id, playerId: command.playerId, initialBalance: command.initialBalance });
      await this.wallets.save(wallet);

      if (command.initialBalance.isPositive()) {
        const opening = WagerTransaction.opening({
          id: this.ids.nextId(),
          walletId: id,
          playerId: command.playerId,
          money: command.initialBalance,
          balanceAfter: command.initialBalance,
          createdAt: this.clock.now(),
        });
        await this.transactions.save(opening);
        const entry = WalletLedgerEntry.create({
          id: this.ids.nextId(),
          walletId: id,
          transactionId: opening.id,
          direction: LedgerDirection.Credit,
          money: command.initialBalance,
          balanceBefore: Money.zero(command.initialBalance.currency),
          balanceAfter: command.initialBalance,
          createdAt: this.clock.now(),
        });
        await this.ledger.append(entry);
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
    } catch (err) {
      // Concurrent duplicate (playerId, currency): the check-then-insert races and
      // the UNIQUE constraint is the backstop — surface it as a 409 conflict.
      if (
        err instanceof UniqueConstraintViolationException &&
        (err as { constraint?: string }).constraint === "wallet_player_currency_unique"
      ) {
        throw new DuplicateWalletError(command.playerId, command.initialBalance.currency);
      }
      throw err;
    }
  }
}
