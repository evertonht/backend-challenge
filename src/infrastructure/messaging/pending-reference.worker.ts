import { Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RetryPendingReferences } from "../../application/use-cases/retry-pending-references";
import { Logger } from "../../observability/logger";

/** Scheduled worker that advances `PENDING_REFERENCE` transactions (§7.1). */
@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnApplicationShutdown {
  private running = false;

  constructor(
    private readonly retry: RetryPendingReferences,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.running = true;
    void this.loop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
  }

  private async loop(): Promise<void> {
    const interval = this.config.get<number>("workers.pendingReferenceIntervalMs") ?? 30_000;
    while (this.running) {
      try {
        await this.retry.execute(50);
      } catch (err) {
        this.logger.error("pending-reference worker batch failed", String(err));
      }
      await this.sleep(interval);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
