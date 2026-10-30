import { Injectable } from "@nestjs/common";
import { LedgerEntryRepository, LedgerPage } from "../ports/ledger-entry-repository";
import { WalletRepository } from "../ports/wallet-repository";

@Injectable()
export class GetLedger {
  constructor(
    private readonly ledger: LedgerEntryRepository,
    private readonly wallets: WalletRepository,
  ) {}

  async execute(walletId: string, cursor: string | undefined, limit: number): Promise<LedgerPage | null> {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) {
      return null;
    }
    return this.ledger.page(walletId, cursor, limit);
  }
}
