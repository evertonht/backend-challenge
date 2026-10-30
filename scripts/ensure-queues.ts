/**
 * Idempotently create the SQS queues the system needs (README §10 + outbox).
 * Run standalone (`bun run scripts/ensure-queues.ts`) or reuse `ensureQueues`
 * from the messaging bootstrap. Targets MiniStack by default.
 */
import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";

export interface QueueConfig {
  queueName: string;
  dlqName: string;
  eventsName: string;
  maxReceiveCount: string;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  queueName: "wager-transactions.fifo",
  dlqName: "wager-transactions-dlq.fifo",
  eventsName: "wager-events.fifo",
  maxReceiveCount: "5",
};

export function createSqsClient(): SQSClient {
  return new SQSClient({
    endpoint: process.env.SQS_ENDPOINT ?? "http://localhost:4566",
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  });
}

async function createFifo(client: SQSClient, name: string, attributes: Record<string, string> = {}): Promise<string> {
  const res = await client.send(
    new CreateQueueCommand({
      QueueName: name,
      Attributes: { FifoQueue: "true", ContentBasedDeduplication: "true", ...attributes },
    }),
  );
  return res.QueueUrl!;
}

async function queueArn(client: SQSClient, queueUrl: string): Promise<string> {
  const res = await client.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["QueueArn"] }));
  return res.Attributes!.QueueArn!;
}

export async function ensureQueues(config: QueueConfig = DEFAULT_QUEUE_CONFIG): Promise<{
  queueUrl: string;
  dlqUrl: string;
  eventsUrl: string;
}> {
  const client = createSqsClient();
  const dlqUrl = await createFifo(client, config.dlqName);
  const dlqArn = await queueArn(client, dlqUrl);
  const queueUrl = await createFifo(client, config.queueName, {
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: config.maxReceiveCount }),
  });
  const eventsUrl = await createFifo(client, config.eventsName);
  return { queueUrl, dlqUrl, eventsUrl };
}

// Standalone entrypoint.
if (import.meta.main) {
  ensureQueues()
    .then((urls) => console.log("queues ready", urls))
    .catch((err) => {
      console.error("failed to ensure queues", err);
      process.exit(1);
    });
}
