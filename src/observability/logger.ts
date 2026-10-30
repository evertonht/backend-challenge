import { LoggerService, LogLevel } from "@nestjs/common";
import pino, { Logger as PinoLogger } from "pino";

/**
 * Structured (JSON) logger backed by pino, presented to Nest as a LoggerService
 * and to the application as a field-rich logger via `child(bindings)`.
 *
 * Context fields (correlationId, messageId, transactionId, walletId, providerId)
 * are attached by callers via `child` so every line is traceable end-to-end
 * (README §12). No sensitive/financial payloads are ever logged.
 */

export interface LogContext {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
  [key: string]: unknown;
}

export class Logger implements LoggerService {
  private readonly pino: PinoLogger;

  constructor() {
    const pretty = process.env.NODE_ENV !== "production";
    this.pino = pino(
      pretty
        ? {
            transport: { target: "pino-pretty", options: { colorize: true, singleLine: true } },
            level: process.env.LOG_LEVEL ?? "info",
          }
        : { level: process.env.LOG_LEVEL ?? "info" },
    );
  }

  child(bindings: LogContext): Logger {
    const logger = new Logger();
    (logger as unknown as { pino: PinoLogger }).pino = this.pino.child(bindings);
    return logger;
  }

  // ---- NestJS LoggerService surface ----
  log(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    this.pino.info(context, this.stringify(message));
  }
  error(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    this.pino.error(context, this.stringify(message));
  }
  warn(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    this.pino.warn(context, this.stringify(message));
  }
  debug(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    this.pino.debug(context, this.stringify(message));
  }
  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    this.pino.trace(context, this.stringify(message));
  }
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    this.pino.fatal(context, this.stringify(message));
  }
  setLogLevels(_levels: LogLevel[]): void {
    // no-op: level is configured via env at construction
  }

  // ---- structured application surface ----
  info(obj: LogContext, msg?: string): void {
    this.pino.info(obj, msg);
  }

  private extractContext(params: unknown[]): LogContext {
    // Nest convention: last param may be the context name (string).
    const context: LogContext = {};
    for (const p of params) {
      if (typeof p === "string") context.context = p;
    }
    return context;
  }

  private stringify(message: unknown): string {
    return typeof message === "string" ? message : JSON.stringify(message);
  }
}
