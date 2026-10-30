import type { IntegrationEvent } from "../../domain/events";

/**
 * Persists an outbox message in the same transaction as the financial change
 * (§11). Never publishes directly — a worker does that later.
 */
export abstract class OutboxWriter {
  abstract enqueue(event: IntegrationEvent<unknown>): Promise<void>;
}
