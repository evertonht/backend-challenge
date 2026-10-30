import type { Wallet } from "../../domain/wallet";

/**
 * Port for wallet persistence. The implementation loads/saves the domain
 * `Wallet`, translating to/from its persistence model. `findForUpdate` is the
 * pessimistic `SELECT … FOR UPDATE` used as the concurrency unit (§5).
 */
export abstract class WalletRepository {
  abstract findById(id: string): Promise<Wallet | null>;
  abstract findForUpdate(id: string): Promise<Wallet | null>;
  abstract findByPlayerCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  abstract save(wallet: Wallet): Promise<void>;
}
