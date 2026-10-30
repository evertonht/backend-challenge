import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { Response } from "express";
import { DeadlockException, DriverException, LockWaitTimeoutException, NotFoundError } from "@mikro-orm/core";
import {
  BusinessRuleError,
  DuplicateWalletError,
  DomainError,
  IdempotencyConflictError,
  InvalidMoneyError,
  InvalidPayloadError,
} from "../../../domain/errors";
import { FailureCode } from "../../../domain/failure-code";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Maps domain/application errors and infrastructure failures to the §9 status
 * codes and the consistent error envelope `{ error: { code, message, details } }`.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof IdempotencyConflictError) {
      this.send(response, HttpStatus.CONFLICT, FailureCode.IdempotencyConflict, exception.message);
      return;
    }
    if (exception instanceof DuplicateWalletError) {
      this.send(response, HttpStatus.CONFLICT, "WALLET_ALREADY_EXISTS", exception.message);
      return;
    }
    if (exception instanceof InvalidPayloadError || exception instanceof InvalidMoneyError) {
      this.send(response, HttpStatus.BAD_REQUEST, FailureCode.InvalidPayload, exception.message);
      return;
    }
    if (exception instanceof BusinessRuleError) {
      this.send(response, HttpStatus.UNPROCESSABLE_ENTITY, exception.code, exception.message);
      return;
    }
    if (exception instanceof BadRequestException) {
      const res = exception.getResponse();
      const details = typeof res === "object" && res !== null ? (res as Record<string, unknown>).message : res;
      this.send(response, HttpStatus.BAD_REQUEST, FailureCode.InvalidPayload, exception.message, details);
      return;
    }
    if (exception instanceof NotFoundException || exception instanceof NotFoundError) {
      this.send(response, HttpStatus.NOT_FOUND, "NOT_FOUND", "Resource not found");
      return;
    }
    if (exception instanceof DeadlockException || exception instanceof LockWaitTimeoutException) {
      this.send(response, HttpStatus.SERVICE_UNAVAILABLE, "LOCK_CONFLICT", "Concurrency conflict, retry");
      return;
    }
    if (exception instanceof DriverException) {
      this.send(response, HttpStatus.SERVICE_UNAVAILABLE, "INFRASTRUCTURE_UNAVAILABLE", "Temporary infrastructure failure");
      return;
    }
    if (exception instanceof HttpException) {
      this.send(response, exception.getStatus(), "HTTP_ERROR", exception.message);
      return;
    }
    if (exception instanceof DomainError) {
      this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", exception.message);
      return;
    }

    const message = exception instanceof Error ? exception.message : "Unexpected error";
    this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message);
  }

  private send(response: Response, status: number, code: string, message: string, details?: unknown): void {
    const body: ErrorBody = { error: { code, message } };
    if (details !== undefined) {
      body.error.details = details;
    }
    response.status(status).json(body);
  }
}
