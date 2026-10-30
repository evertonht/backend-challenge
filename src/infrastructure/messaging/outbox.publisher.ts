import { Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { MikroORM, LockMode } from "@mikro-orm/core";
import { SqsClient } from "./sqs.client";
import { OutboxMessageEntity } from "../persistence/entities/outbox-message.entity";
import { Logger } from "../../observability/logger";
import { Metrics } from "../../observability/metrics";

interface ClaimedRow {
  id: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Transactional outbox publisher (§11 / ticket 08). Polls pending rows, claims
 * them with `FOR UPDATE SKIP LOCKED` (bumping attempts + backoff), publishes to
 * `wager-events.fifo` outside any transaction, then marks them published.
 * At-least-once: a crash between publish and mark causes a duplicate publish,
 * which downstream consumers dedupe by `eventId`.
 */
@Injectable()
export class OutboxPublisher implements OnModuleInit, OnApplicationShutdown {
  private running = false;

  constructor(
    private readonly orm: MikroORM,
    private readonly sqs: SqsClient,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
  ) {}

  async onModuleInit(): Promise<void> {
    this.running = true;
    void this.loop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const published = await this.publishBatch();
        if (published > 0) {
          this.metrics.counter("outbox_published", undefined, published);
        }
      } catch (err) {
        this.logger.error("outbox publish batch failed", String(err));
      }
      this.metrics.gauge("outbox_lag", await this.pendingCount().catch(() => -1));
      await this.sleep(2000);
    }
  }

  private async publishBatch(): Promise<number> {
    const claimed = await this.claimDue(50);
    let published = 0;
    for (const row of claimed) {
      try {
        await this.sqs.send(this.sqs.eventsUrl, JSON.stringify(row.payload), row.aggregateId);
        await this.markPublished(row.id);
        published += 1;
      } catch (err) {
        // next_attempt_at was already bumped by the claim → retried later.
        this.metrics.counter("outbox_publish_errors");
        this.logger.warn(`outbox publish failed for ${row.id}: ${String(err)}`);
      }
    }
    return published;
  }

  private async claimDue(limit: number): Promise<ClaimedRow[]> {
    const em = this.orm.em.fork();
    const now = new Date();
    return em.transactional(async (txEm) => {
      const rows = await txEm.find(
        OutboxMessageEntity,
        { publishedAt: null, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
        { limit, orderBy: { nextAttemptAt: "ASC" }, lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE },
      );
      const claimed: ClaimedRow[] = [];
      for (const r of rows) {
        const attempts = (r.attempts ?? 0) + 1;
        const delay = Math.min(2000 * 2 ** (attempts - 1), 60_000);
        txEm.assign(r, { attempts, nextAttemptAt: new Date(now.getTime() + delay) });
        claimed.push({ id: r.id, aggregateId: r.aggregateId, payload: r.payload });
      }
      return claimed;
    });
  }

  private async markPublished(id: string): Promise<void> {
    const em = this.orm.em.fork();
    await em.transactional(async (txEm) => {
      const row = await txEm.findOne(OutboxMessageEntity, id);
      if (row) {
        txEm.assign(row, { publishedAt: new Date() });
      }
    });
  }

  private async pendingCount(): Promise<number> {
    const em = this.orm.em.fork();
    return em.count(OutboxMessageEntity, { publishedAt: null });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
