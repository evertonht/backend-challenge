import type { InboxMessage } from "../../domain/inbox-message";

/**
 * Persistent inbox dedup (§10). The `UNIQUE(consumer_name, message_id)` in the
 * schema makes redelivery idempotent. `record` inserts the received message in
 * the same SQL transaction as the financial change (§11); `exists` is the cheap
 * fast-path the consumer checks before invoking the use case.
 */
export abstract class InboxRepository {
  abstract record(message: InboxMessage): Promise<void>;
  abstract exists(consumerName: string, messageId: string): Promise<boolean>;
}
