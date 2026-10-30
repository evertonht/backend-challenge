import { Injectable } from "@nestjs/common";
import { WagerTransaction } from "../../domain/wager-transaction";
import { WagerTransactionRepository } from "../ports/wager-transaction-repository";

@Injectable()
export class GetTransaction {
  constructor(private readonly transactions: WagerTransactionRepository) {}

  async byId(id: string): Promise<WagerTransaction | null> {
    return this.transactions.findById(id);
  }

  async byProviderExternal(providerId: string, externalTransactionId: string): Promise<WagerTransaction | null> {
    return this.transactions.findByProviderExternal(providerId, externalTransactionId);
  }
}
