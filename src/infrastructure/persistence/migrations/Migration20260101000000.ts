import { Migration } from "@mikro-orm/migrations";

/**
 * Initial schema (§5.9 / ticket 05). Uniqueness, non-negativity, ledger
 * arithmetic and the pending-outbox partial index all live here, in the schema,
 * not just in application code. The ledger table's immutability is enforced by
 * revoking UPDATE/DELETE (the application role holds SELECT+INSERT only).
 */
export class Migration20260101000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wallet (
        id uuid PRIMARY KEY,
        player_id text NOT NULL,
        currency text NOT NULL,
        balance numeric(20,2) NOT NULL DEFAULT 0,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT wallet_balance_nonnegative CHECK (balance >= 0),
        CONSTRAINT wallet_player_currency_unique UNIQUE (player_id, currency)
      );

      CREATE TABLE wager_transaction (
        id uuid PRIMARY KEY,
        provider_id text NOT NULL,
        external_transaction_id text NOT NULL,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        wallet_id uuid NOT NULL REFERENCES wallet (id),
        player_id text NOT NULL,
        round_id text NOT NULL,
        game_id text NOT NULL,
        kind text NOT NULL,
        amount numeric(20,2) NOT NULL,
        currency text NOT NULL,
        reference_external_transaction_id text,
        reference_transaction_id uuid,
        status text NOT NULL,
        failure_code text,
        balance_after numeric(20,2),
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        created_at timestamptz NOT NULL,
        processed_at timestamptz,
        CONSTRAINT wager_tx_idempotency_unique UNIQUE (idempotency_key),
        CONSTRAINT wager_tx_provider_external_unique UNIQUE (provider_id, external_transaction_id)
      );
      CREATE INDEX wager_tx_wallet_id_idx ON wager_transaction (wallet_id);
      CREATE INDEX wager_tx_status_idx ON wager_transaction (status);
      CREATE INDEX wager_tx_wallet_created_idx ON wager_transaction (wallet_id, created_at);

      CREATE TABLE wallet_ledger_entry (
        id uuid PRIMARY KEY,
        wallet_id uuid NOT NULL REFERENCES wallet (id),
        transaction_id uuid NOT NULL REFERENCES wager_transaction (id),
        direction text NOT NULL,
        amount numeric(20,2) NOT NULL,
        currency text NOT NULL,
        balance_before numeric(20,2) NOT NULL,
        balance_after numeric(20,2) NOT NULL,
        created_at timestamptz NOT NULL,
        CONSTRAINT ledger_transaction_unique UNIQUE (transaction_id),
        CONSTRAINT ledger_arithmetic_check CHECK (
          (direction = 'CREDIT' AND balance_after = balance_before + amount)
          OR (direction = 'DEBIT' AND balance_after = balance_before - amount)
        )
      );
      CREATE INDEX ledger_wallet_created_idx ON wallet_ledger_entry (wallet_id, created_at, id);

      CREATE TABLE inbox_message (
        id uuid PRIMARY KEY,
        message_id text NOT NULL,
        consumer_name text NOT NULL,
        payload_hash text NOT NULL,
        received_at timestamptz NOT NULL,
        processed_at timestamptz,
        CONSTRAINT inbox_consumer_message_unique UNIQUE (consumer_name, message_id)
      );

      CREATE TABLE outbox_message (
        id uuid PRIMARY KEY,
        aggregate_id uuid NOT NULL,
        event_type text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        published_at timestamptz
      );
      CREATE INDEX outbox_pending_idx ON outbox_message (next_attempt_at) WHERE published_at IS NULL;

      -- Ledger immutability: the application role may only SELECT + INSERT.
      REVOKE UPDATE, DELETE ON wallet_ledger_entry FROM PUBLIC;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TABLE IF EXISTS outbox_message;
      DROP TABLE IF EXISTS inbox_message;
      DROP TABLE IF EXISTS wallet_ledger_entry;
      DROP TABLE IF EXISTS wager_transaction;
      DROP TABLE IF EXISTS wallet;
    `);
  }
}
