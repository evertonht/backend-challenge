import { Global, Module } from "@nestjs/common";
import { Logger } from "./logger";
import { Metrics } from "./metrics";

@Global()
@Module({
  providers: [Logger, Metrics],
  exports: [Logger, Metrics],
})
export class ObservabilityModule {}
