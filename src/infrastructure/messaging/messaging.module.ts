import { Module } from "@nestjs/common";
import { ApplicationModule } from "../../application/application.module";
import { SqsClient } from "./sqs.client";
import { InboxConsumer } from "./inbox.consumer";
import { OutboxPublisher } from "./outbox.publisher";
import { PendingReferenceWorker } from "./pending-reference.worker";

@Module({
  imports: [ApplicationModule],
  providers: [SqsClient, InboxConsumer, OutboxPublisher, PendingReferenceWorker],
  exports: [SqsClient],
})
export class MessagingModule {}
