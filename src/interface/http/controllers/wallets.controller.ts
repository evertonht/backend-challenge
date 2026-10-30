import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { GetWallet } from "../../../application/use-cases/get-wallet";
import { GetLedger } from "../../../application/use-cases/get-ledger";
import { OpenWallet } from "../../../application/use-cases/open-wallet";
import { Reconcile } from "../../../application/use-cases/reconcile";
import { CreateWalletDto } from "../dto/create-wallet.dto";
import { LedgerQueryDto } from "../dto/ledger-query.dto";
import { ledgerEntryView, walletView } from "../serializers";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly openWallet: OpenWallet,
    private readonly getWallet: GetWallet,
    private readonly getLedger: GetLedger,
    private readonly reconcile: Reconcile,
  ) {}

  @Post()
  async create(@Body() dto: CreateWalletDto) {
    const result = await this.openWallet.execute({
      playerId: dto.playerId,
      initialBalance: dto.initialBalance.toMoney(),
    });
    return result;
  }

  @Get(":walletId")
  async findOne(@Param("walletId") walletId: string) {
    const wallet = await this.getWallet.execute(walletId);
    if (!wallet) {
      throw new NotFoundException();
    }
    return walletView(wallet);
  }

  @Get(":walletId/ledger")
  async ledger(@Param("walletId") walletId: string, @Query() query: LedgerQueryDto) {
    const page = await this.getLedger.execute(walletId, query.cursor, query.limit ?? 50);
    if (!page) {
      throw new NotFoundException();
    }
    return {
      entries: page.entries.map(ledgerEntryView),
      nextCursor: page.nextCursor,
    };
  }

  @Post(":walletId/reconciliation")
  async reconciliation(@Param("walletId") walletId: string) {
    const result = await this.reconcile.execute(walletId);
    if (!result) {
      throw new NotFoundException();
    }
    return result;
  }
}
