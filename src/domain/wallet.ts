import { LedgerDirection } from "./enums";
import { CurrencyMismatchError, InsufficientBalanceError } from "./errors";
import { WalletLedgerEntry } from "./ledger-entry";
import { Money, MoneyProps } from "./money";

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

export interface ApplyMoneyProps {
  entryId: string;
  transactionId: string;
  money: Money;
  at?: Date;
}

/**
 * Wallet aggregate root (§6.2). Encapsulates the balance and version; debit/
 * credit apply a movement while keeping balance and ledger consistent (the
 * resulting ledger entry is returned to the caller, which persists it in the
 * same transaction as the wallet).
 */
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open({ id, playerId, initialBalance }: OpenWalletProps): Wallet {
    const now = new Date();
    return new Wallet(id, playerId, initialBalance.currency, initialBalance, 1, now, now);
  }

  /** Reconstruction from persistence — does not revalidate transitions (§6.0). */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.rehydrate(state.balance),
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(props: ApplyMoneyProps): WalletLedgerEntry {
    this.assertSameCurrency(props.money);
    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(props.money);
    if (balanceAfter.isNegative()) {
      throw new InsufficientBalanceError();
    }
    const entry = WalletLedgerEntry.create({
      id: props.entryId,
      walletId: this.id,
      transactionId: props.transactionId,
      direction: LedgerDirection.Debit,
      money: props.money,
      balanceBefore,
      balanceAfter,
      createdAt: props.at,
    });
    this.apply(entry);
    return entry;
  }

  credit(props: ApplyMoneyProps): WalletLedgerEntry {
    this.assertSameCurrency(props.money);
    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(props.money);
    const entry = WalletLedgerEntry.create({
      id: props.entryId,
      walletId: this.id,
      transactionId: props.transactionId,
      direction: LedgerDirection.Credit,
      money: props.money,
      balanceBefore,
      balanceAfter,
      createdAt: props.at,
    });
    this.apply(entry);
    return entry;
  }

  private apply(entry: WalletLedgerEntry): void {
    const changed = !entry.balanceAfter.equals(this._balance);
    this._balance = entry.balanceAfter;
    if (changed) {
      this._version += 1;
    }
    this._updatedAt = entry.createdAt;
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
