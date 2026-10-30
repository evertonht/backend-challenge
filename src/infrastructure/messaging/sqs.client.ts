import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from "@aws-sdk/client-sqs";

export interface ReceivedMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
  receiveCount: number;
}

/**
 * Thin wrapper over `@aws-sdk/client-sqs` pointed at MiniStack. FIFO sends
 * require a `MessageGroupId`; the caller supplies it.
 */
@Injectable()
export class SqsClient {
  private readonly client: SQSClient;
  readonly queueUrl: string;
  readonly dlqUrl: string;
  readonly eventsUrl: string;

  constructor(config: ConfigService) {
    this.queueUrl = config.get<string>("sqs.queueUrl") ?? "http://localhost:4566/000000000000/wager-transactions.fifo";
    this.dlqUrl = config.get<string>("sqs.dlqUrl") ?? "http://localhost:4566/000000000000/wager-transactions-dlq.fifo";
    this.eventsUrl = config.get<string>("sqs.eventsUrl") ?? "http://localhost:4566/000000000000/wager-events.fifo";
    this.client = new SQSClient({
      endpoint: config.get<string>("sqs.endpoint") ?? "http://localhost:4566",
      region: config.get<string>("sqs.region") ?? "us-east-1",
      credentials: {
        accessKeyId: config.get<string>("sqs.accessKeyId") ?? "test",
        secretAccessKey: config.get<string>("sqs.secretAccessKey") ?? "test",
      },
    });
  }

  async send(queueUrl: string, body: string, messageGroupId: string): Promise<void> {
    await this.client.send(
      new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body, MessageGroupId: messageGroupId }),
    );
  }

  async receive(queueUrl: string, opts: { maxMessages: number; waitTimeSeconds: number }): Promise<ReceivedMessage[]> {
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: opts.maxMessages,
        WaitTimeSeconds: opts.waitTimeSeconds,
        MessageSystemAttributeNames: ["ApproximateReceiveCount"],
      }),
    );
    return (res.Messages ?? []).map((m) => ({
      messageId: m.MessageId ?? "",
      receiptHandle: m.ReceiptHandle ?? "",
      body: m.Body ?? "",
      receiveCount: parseInt(m.Attributes?.ApproximateReceiveCount ?? "1", 10),
    }));
  }

  async delete(queueUrl: string, receiptHandle: string): Promise<void> {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
  }

  async changeVisibility(queueUrl: string, receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeoutSeconds,
      }),
    );
  }

  /** Best-effort liveness probe used by the readiness health check. */
  async ping(): Promise<boolean> {
    try {
      await this.client.send(new ReceiveMessageCommand({ QueueUrl: this.queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }));
      return true;
    } catch {
      return false;
    }
  }
}
