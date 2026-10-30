import { Injectable } from "@nestjs/common";
import { LockMode, MikroORM } from "@mikro-orm/core";
import { WalletRepository } from "../../../application/ports/wallet-repository";
import { Wallet } from "../../../domain/wallet";
import { EntityManagerContext } from "../entity-manager-context";
import { WalletEntity } from "../entities/wallet.entity";
import { walletToData, walletToDomain } from "../mappers";

@Injectable()
export class MikroOrmWalletRepository extends WalletRepository {
  constructor(
    private readonly orm: MikroORM,
    private readonly ctx: EntityManagerContext,
  ) {
    super();
  }

  private get em() {
    return this.ctx.current() ?? this.orm.em.fork();
  }

  async findById(id: string): Promise<Wallet | null> {
    const e = await this.em.findOne(WalletEntity, id);
    return e ? walletToDomain(e) : null;
  }

  async findForUpdate(id: string): Promise<Wallet | null> {
    const e = await this.em.findOne(WalletEntity, id, { lockMode: LockMode.PESSIMISTIC_WRITE });
    return e ? walletToDomain(e) : null;
  }

  async findByPlayerCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const e = await this.em.findOne(WalletEntity, { playerId, currency });
    return e ? walletToDomain(e) : null;
  }

  async save(wallet: Wallet): Promise<void> {
    // Upsert handles both new wallets (INSERT) and wallets mutated in this
    // transaction or a previous one (UPDATE) uniformly.
    const data = walletToData(wallet);
    await this.em.upsert(WalletEntity, { id: wallet.id, createdAt: wallet.createdAt, ...data } as never);
  }
}
