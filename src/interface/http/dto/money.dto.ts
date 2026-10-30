import { IsString, Matches } from "class-validator";
import { Money } from "../../../domain/money";

const AMOUNT_REGEX = /^\d+(?:\.\d{1,2})?$/;
const CURRENCY_REGEX = /^[A-Z]{3}$/;

export class MoneyDto {
  @IsString()
  @Matches(AMOUNT_REGEX, { message: "amount must be a decimal string with at most 2 decimals" })
  amount!: string;

  @IsString()
  @Matches(CURRENCY_REGEX, { message: "currency must be a 3-letter ISO-4217 code" })
  currency!: string;

  toMoney(): Money {
    return Money.from({ amount: this.amount, currency: this.currency });
  }
}
