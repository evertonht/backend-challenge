import { LockMode, MikroORM } from "@mikro-orm/core";
import { WalletRepository } from "../../../application/ports/wallet-repository";
import { Wallet } from "../../../domain/wallet";
import { EntityManagerContext } from "../entity-manager-context";
import { WalletEntity } from "../entities/wallet.entity";
import { walletToData, walletToDomain } from "../mappers";

export class MikroOrmWalletRepository extends WalletRepository {
  constructor(
    private readonly orm: MikroORM,
    private readonly ctx: EntityManagerContext,
  ) {
    super();
  }

  private get em() {
    return this.ctx.current() ?? this.orm.em;
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
    // mapping boundary: the domain → persistence shape is constructed by the mapper.
    const data = walletToData(wallet);
    const managed = this.em.getUnitOfWork().getById(WalletEntity.name, wallet.id) as WalletEntity | undefined;
    if (managed) {
      this.em.assign(managed, data as never);
    } else {
      this.em.create(WalletEntity, { id: wallet.id, createdAt: wallet.createdAt, ...data } as never);
    }
  }
}
