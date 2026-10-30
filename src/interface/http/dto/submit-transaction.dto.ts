import { Type } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from "class-validator";
import { WagerTransactionKind } from "../../../domain/enums";
import { MoneyDto } from "./money.dto";

const SUBMITTABLE_KINDS: string[] = [
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
];

export class SubmitTransactionDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @IsIn(SUBMITTABLE_KINDS, { message: "kind must be BET | WIN | LOSS | REFUND | ROLLBACK" })
  kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}
