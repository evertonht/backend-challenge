import { Controller, Get, Res } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/core";
import type { Response } from "express";
import { SqsClient } from "../../../infrastructure/messaging/sqs.client";

@Controller("health")
export class HealthController {
  constructor(
    private readonly orm: MikroORM,
    private readonly sqs: SqsClient,
  ) {}

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, string> = {};
    let dbUp = false;
    try {
      await this.orm.em.fork().getConnection().execute("SELECT 1");
      dbUp = true;
      checks.postgresql = "up";
    } catch {
      checks.postgresql = "down";
    }

    let sqsUp = false;
    try {
      sqsUp = await this.sqs.ping();
      checks.sqs = sqsUp ? "up" : "down";
    } catch {
      checks.sqs = "down";
    }

    const ready = dbUp && sqsUp;
    res.status(ready ? 200 : 503);
    return { status: ready ? "ready" : "not_ready", checks };
  }
}
