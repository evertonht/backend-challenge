import { Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SqsClient, ReceivedMessage } from "./sqs.client";
import { SubmitTransaction } from "../../application/use-cases/submit-transaction";
import { InboxRepository } from "../../application/ports/inbox-repository";
import { computePayloadHash } from "../../application/idempotency";
import { WagerTransactionKind } from "../../domain/enums";
import { BusinessRuleError, InvalidMoneyError, InvalidPayloadError } from "../../domain/errors";
import { Money } from "../../domain/money";
import { Logger } from "../../observability/logger";
import { Metrics } from "../../observability/metrics";
import { DriverException } from "@mikro-orm/core";

const CONSUMER_NAME = "wager-transactions";

interface Envelope {
  messageId: string;
  type: string;
  occurredAt?: string;
  data: {
    idempotencyKey?: string;
    providerId: string;
    externalTransactionId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  };
}

/**
 * SQS inbox consumer (§10). Long-polls `wager-transactions.fifo`, deduplicates
 * via the persistent inbox, and reuses the HTTP use case. Ack only after commit.
 */
@Injectable()
export class InboxConsumer implements OnModuleInit, OnApplicationShutdown {
  private running = false;
  private inFlight = new Set<Promise<void>>();

  constructor(
    private readonly sqs: SqsClient,
    private readonly submitTransaction: SubmitTransaction,
    private readonly inbox: InboxRepository,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.running = true;
    void this.loop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await Promise.allSettled([...this.inFlight]);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.sqs.receive(this.sqs.queueUrl, { maxMessages: 10, waitTimeSeconds: 20 });
        for (const msg of messages) {
          const task = this.handle(msg);
          this.inFlight.add(task);
          void task.finally(() => this.inFlight.delete(task));
        }
      } catch (err) {
        this.logger.error("sqs receive failed", String(err));
        await this.sleep(1000);
      }
    }
  }

  private async handle(msg: ReceivedMessage): Promise<void> {
    try {
      const envelope = this.parse(msg);
      if (!envelope) {
        // Malformed / wrong type → leave unacked so maxReceiveCount redrives it to the DLQ.
        this.metrics.counter("sqs_malformed");
        return;
      }

      const { messageId, data } = envelope;
      if (await this.inbox.exists(CONSUMER_NAME, messageId)) {
        this.metrics.counter("inbox_duplicates", { consumer: CONSUMER_NAME });
        await this.sqs.delete(this.sqs.queueUrl, msg.receiptHandle);
        return;
      }

      const money = Money.from(data.money);
      const payloadHash = computePayloadHash({
        providerId: data.providerId,
        externalTransactionId: data.externalTransactionId,
        playerId: data.playerId,
        walletId: data.walletId,
        roundId: data.roundId,
        gameId: data.gameId,
        kind: data.kind,
        money: money.toJSON(),
        ...(data.referenceExternalTransactionId !== undefined
          ? { referenceExternalTransactionId: data.referenceExternalTransactionId }
          : {}),
      });

      const result = await this.submitTransaction.execute({
        idempotencyKey: data.idempotencyKey ?? `${data.providerId}:${data.externalTransactionId}`,
        payloadHash,
        providerId: data.providerId,
        externalTransactionId: data.externalTransactionId,
        playerId: data.playerId,
        walletId: data.walletId,
        roundId: data.roundId,
        gameId: data.gameId,
        kind: data.kind,
        money,
        referenceExternalTransactionId: data.referenceExternalTransactionId,
        correlationId: messageId,
        consumerName: CONSUMER_NAME,
        messageId,
      });

      this.metrics.counter("transactions", { status: result.status, source: "sqs" });
      await this.sqs.delete(this.sqs.queueUrl, msg.receiptHandle);
    } catch (err) {
      if (err instanceof BusinessRuleError || err instanceof InvalidMoneyError || err instanceof InvalidPayloadError) {
        // Terminal business outcome → ack (do not redeliver).
        await this.sqs.delete(this.sqs.queueUrl, msg.receiptHandle).catch(() => undefined);
      } else if (err instanceof DriverException) {
        // Transient infra → leave unacked; visibility timeout redelivers.
        this.metrics.counter("sqs_transient_errors");
      } else {
        // Unknown/permanent → leave unacked → DLQ via maxReceiveCount.
        this.logger.error("sqs message processing failed", String(err));
      }
    }
  }

  private parse(msg: ReceivedMessage): Envelope | null {
    try {
      const parsed = JSON.parse(msg.body) as Envelope;
      if (parsed?.type !== "WagerTransactionRequested" || !parsed.data) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
