import { Type } from "class-transformer";
import { IsNotEmpty, IsString, ValidateNested } from "class-validator";
import { MoneyDto } from "./money.dto";

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}
