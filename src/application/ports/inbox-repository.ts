import type { InboxMessage } from "../../domain/inbox-message";

/**
 * Persistent inbox dedup (§10). The `UNIQUE(consumer_name, message_id)` in the
 * schema makes redelivery idempotent; this port records a received message in
 * the same SQL transaction as the financial change (§11).
 */
export abstract class InboxRepository {
  /** Returns `true` if newly recorded, `false` if the message was already present. */
  abstract record(message: InboxMessage): Promise<boolean>;
  abstract exists(consumerName: string, messageId: string): Promise<boolean>;
}
