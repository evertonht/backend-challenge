import { Injectable } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/core";
import { LedgerEntryRepository, LedgerPage } from "../../../application/ports/ledger-entry-repository";
import { LedgerDirection } from "../../../domain/enums";
import { WalletLedgerEntry } from "../../../domain/ledger-entry";
import { Money } from "../../../domain/money";
import { EntityManagerContext } from "../entity-manager-context";
import { WalletLedgerEntryEntity } from "../entities/ledger-entry.entity";
import { entryToData, entryToDomain } from "../mappers";

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt, i: id })).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { c: string; i: string };
  return { createdAt: parsed.c, id: parsed.i };
}

interface LedgerRow {
  id: string;
  wallet_id: string;
  transaction_id: string;
  direction: string;
  amount: string;
  currency: string;
  balance_before: string;
  balance_after: string;
  created_at: Date | string;
}

function rowToEntry(row: LedgerRow): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: row.id,
    walletId: row.wallet_id,
    transactionId: row.transaction_id,
    direction: row.direction as LedgerDirection,
    money: { amount: row.amount, currency: row.currency },
    balanceBefore: { amount: row.balance_before, currency: row.currency },
    balanceAfter: { amount: row.balance_after, currency: row.currency },
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  });
}

@Injectable()
export class MikroOrmLedgerEntryRepository extends LedgerEntryRepository {
  constructor(
    private readonly orm: MikroORM,
    private readonly ctx: EntityManagerContext,
  ) {
    super();
  }

  private get em() {
    return this.ctx.current() ?? this.orm.em.fork();
  }

  async append(entry: WalletLedgerEntry): Promise<void> {
    this.em.create(WalletLedgerEntryEntity, entryToData(entry) as never);
  }

  async page(walletId: string, cursor: string | undefined, limit: number): Promise<LedgerPage> {
    const conn = this.em.getConnection();
    const fetchLimit = limit + 1;
    let rows: LedgerRow[];
    if (cursor) {
      const { createdAt, id } = decodeCursor(cursor);
      rows = await conn.execute(
        `SELECT * FROM wallet_ledger_entry
         WHERE wallet_id = ? AND (created_at > ? OR (created_at = ? AND id::text > ?))
         ORDER BY created_at ASC, id::text ASC
         LIMIT ?`,
        [walletId, createdAt, createdAt, id, fetchLimit],
      );
    } else {
      rows = await conn.execute(
        `SELECT * FROM wallet_ledger_entry
         WHERE wallet_id = ?
         ORDER BY created_at ASC, id::text ASC
         LIMIT ?`,
        [walletId, fetchLimit],
      );
    }
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const entries = pageRows.map(rowToEntry);
    const nextCursor = hasMore
      ? encodeCursor(String(pageRows[pageRows.length - 1]!.created_at), pageRows[pageRows.length - 1]!.id)
      : null;
    return { entries, nextCursor };
  }

  async sum(walletId: string, currency: string): Promise<Money> {
    const rows = await this.em.getConnection().execute(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) AS total
       FROM wallet_ledger_entry WHERE wallet_id = ?`,
      [walletId],
    );
    const total = rows[0]?.total as string | undefined;
    return Money.rehydrate({ amount: total ?? "0", currency });
  }

  async count(walletId: string): Promise<number> {
    return this.em.count(WalletLedgerEntryEntity, { walletId });
  }
}
