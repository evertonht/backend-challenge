import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { configuration } from "./config/configuration";
import { ObservabilityModule } from "./observability/observability.module";
import { ApplicationModule } from "./application/application.module";
import { PersistenceModule } from "./infrastructure/persistence/persistence.module";
import { MessagingModule } from "./infrastructure/messaging/messaging.module";
import { InterfaceModule } from "./interface/interface.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ObservabilityModule,
    ApplicationModule,
    PersistenceModule,
    MessagingModule,
    InterfaceModule,
  ],
})
export class AppModule {}
