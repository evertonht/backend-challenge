export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  sqs: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    queueUrl: string;
    dlqUrl: string;
    eventsUrl: string;
  };
  workers: {
    inboxMaxReceiveCount: number;
    inboxVisibilityTimeout: number;
    pendingReferenceIntervalMs: number;
    outboxPollIntervalMs: number;
  };
}

export function configuration(): AppConfig {
  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    nodeEnv: process.env.NODE_ENV ?? "development",
    databaseUrl: process.env.DATABASE_URL ?? "postgres://wagering:wagering@localhost:5432/wagering",
    sqs: {
      endpoint: process.env.SQS_ENDPOINT ?? "http://localhost:4566",
      region: process.env.AWS_REGION ?? "us-east-1",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
      queueUrl: process.env.SQS_QUEUE_URL ?? "http://localhost:4566/000000000000/wager-transactions.fifo",
      dlqUrl: process.env.SQS_DLQ_URL ?? "http://localhost:4566/000000000000/wager-transactions-dlq.fifo",
      eventsUrl: process.env.SQS_EVENTS_URL ?? "http://localhost:4566/000000000000/wager-events.fifo",
    },
    workers: {
      inboxMaxReceiveCount: parseInt(process.env.INBOX_MAX_RECEIVE_COUNT ?? "5", 10),
      inboxVisibilityTimeout: parseInt(process.env.INBOX_VISIBILITY_TIMEOUT ?? "30", 10),
      pendingReferenceIntervalMs: parseInt(process.env.PENDING_REFERENCE_INTERVAL_MS ?? "30000", 10),
      outboxPollIntervalMs: parseInt(process.env.OUTBOX_POLL_INTERVAL_MS ?? "2000", 10),
    },
  };
}
