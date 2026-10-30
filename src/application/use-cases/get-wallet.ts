import { Wallet } from "../../domain/wallet";
import { WalletRepository } from "../ports/wallet-repository";

export class GetWallet {
  constructor(private readonly wallets: WalletRepository) {}

  async execute(walletId: string): Promise<Wallet | null> {
    return this.wallets.findById(walletId);
  }
}
