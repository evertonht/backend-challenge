import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { SubmitTransaction, SubmitTransactionResult } from "../../../application/use-cases/submit-transaction";
import { GetTransaction } from "../../../application/use-cases/get-transaction";
import { computePayloadHash } from "../../../application/idempotency";
import { WagerTransactionStatus } from "../../../domain/enums";
import { IdGenerator } from "../../../application/ports/id-generator";
import { SubmitTransactionDto } from "../dto/submit-transaction.dto";
import { transactionView } from "../serializers";

function statusFor(status: WagerTransactionStatus): number {
  switch (status) {
    case WagerTransactionStatus.Processed:
      return 200;
    case WagerTransactionStatus.PendingReference:
      return 202;
    case WagerTransactionStatus.Rejected:
      return 422;
    default:
      return 500;
  }
}

function submitView(result: SubmitTransactionResult) {
  return {
    transactionId: result.transactionId,
    status: result.status,
    ...(result.balance ? { balance: result.balance } : {}),
    ...(result.failureCode ? { failureCode: result.failureCode } : {}),
    idempotentReplay: result.idempotentReplay,
  };
}

@Controller()
export class TransactionsController {
  constructor(
    private readonly submitTransaction: SubmitTransaction,
    private readonly getTransaction: GetTransaction,
    private readonly ids: IdGenerator,
  ) {}

  @Post("wagering/transactions")
  async submit(
    @Body() dto: SubmitTransactionDto,
    @Headers("idempotency-key") idempotencyKeyHeader: string | undefined,
    @Headers("x-correlation-id") correlationIdHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const idempotencyKey = idempotencyKeyHeader ?? `${dto.providerId}:${dto.externalTransactionId}`;
    const money = dto.money.toMoney();
    const payloadHash = computePayloadHash({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: money.toJSON(),
      ...(dto.referenceExternalTransactionId !== undefined
        ? { referenceExternalTransactionId: dto.referenceExternalTransactionId }
        : {}),
    });

    const result = await this.submitTransaction.execute({
      idempotencyKey,
      payloadHash,
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money,
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
      correlationId: correlationIdHeader ?? this.ids.nextId(),
    });

    res.status(statusFor(result.status));
    return submitView(result);
  }

  @Get("wagering/transactions/:transactionId")
  async byId(@Param("transactionId") transactionId: string) {
    const tx = await this.getTransaction.byId(transactionId);
    if (!tx) {
      throw new NotFoundException();
    }
    return transactionView(tx);
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  async byProviderExternal(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ) {
    const tx = await this.getTransaction.byProviderExternal(providerId, externalTransactionId);
    if (!tx) {
      throw new NotFoundException();
    }
    return transactionView(tx);
  }
}
