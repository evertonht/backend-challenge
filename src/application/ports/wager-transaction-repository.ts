import type { WagerTransaction } from "../../domain/wager-transaction";

export abstract class WagerTransactionRepository {
  abstract findById(id: string): Promise<WagerTransaction | null>;
  abstract findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null>;
  abstract findByProviderExternal(providerId: string, externalTransactionId: string): Promise<WagerTransaction | null>;
  abstract save(tx: WagerTransaction): Promise<void>;
  /** PENDING_REFERENCE transactions due for a re-attempt (for the scheduled worker). */
  abstract findDuePendingReferences(now: Date, limit: number): Promise<WagerTransaction[]>;
  /** A PROCESSED REFUND/ROLLBACK already reversing the given external reference (if any). */
  abstract findProcessedReversal(providerId: string, referenceExternalTransactionId: string): Promise<WagerTransaction | null>;
}
