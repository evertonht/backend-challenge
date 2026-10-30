import type { WalletLedgerEntry } from "../../domain/ledger-entry";
import type { Money } from "../../domain/money";

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor: string | null;
}

export abstract class LedgerEntryRepository {
  abstract append(entry: WalletLedgerEntry): Promise<void>;
  /** Keyset pagination over `(created_at, id)` with an opaque base64url cursor. */
  abstract page(walletId: string, cursor: string | undefined, limit: number): Promise<LedgerPage>;
  /** Reconstructs the wallet balance by summing the ledger (reconciliation). */
  abstract sum(walletId: string, currency: string): Promise<Money>;
  abstract count(walletId: string): Promise<number>;
}
