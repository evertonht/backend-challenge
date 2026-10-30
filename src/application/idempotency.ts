import { createHash } from "node:crypto";
import type { WagerTransactionKind } from "../domain/enums";

/**
 * Idempotency payload hash (§6 / ticket 06): SHA-256 (lowercase hex) of the
 * canonical JSON (recursively sorted keys, no whitespace, UTF-8) of the
 * business subset only — transport/header metadata never enters the hash.
 */

export interface IdempotencyBusinessSubset {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = sortKeys(source[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function computePayloadHash(subset: IdempotencyBusinessSubset): string {
  return createHash("sha256").update(canonicalJson(subset), "utf8").digest("hex");
}
