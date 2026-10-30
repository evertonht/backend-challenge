import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApplicationModule } from "../application/application.module";
import { MessagingModule } from "../infrastructure/messaging/messaging.module";
import { WalletsController } from "./http/controllers/wallets.controller";
import { TransactionsController } from "./http/controllers/transactions.controller";
import { HealthController } from "./http/controllers/health.controller";
import { HttpExceptionFilter } from "./http/exceptions/http-exception.filter";

@Module({
  imports: [ApplicationModule, MessagingModule],
  controllers: [WalletsController, TransactionsController, HealthController],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class InterfaceModule {}
