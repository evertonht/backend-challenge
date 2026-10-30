import { Controller, Get, Res } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/core";
import type { Response } from "express";

@Controller("health")
export class HealthController {
  constructor(private readonly orm: MikroORM) {}

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, string> = {};
    let dbUp = false;
    try {
      await this.orm.em.getConnection().execute("SELECT 1");
      dbUp = true;
      checks.postgresql = "up";
    } catch {
      checks.postgresql = "down";
    }

    const ready = dbUp;
    res.status(ready ? 200 : 503);
    return { status: ready ? "ready" : "not_ready", checks };
  }
}
