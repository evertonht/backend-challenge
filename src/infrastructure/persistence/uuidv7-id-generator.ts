import { IdGenerator } from "../../application/ports/id-generator";

/**
 * UUIDv7 (RFC 9562) generator. Uses Bun's native `randomUUIDv7` when available,
 * otherwise a small standards-compliant v7 implementation (time-ordered ms
 * timestamp + 74 bits of randomness). Never `gen_random_uuid()` (v4) — the id
 * must be app-side and time-ordered for index locality and ledger cursors.
 */
export class Uuidv7IdGenerator extends IdGenerator {
  nextId(): string {
    if (typeof Bun !== "undefined" && typeof (Bun as { randomUUIDv7?: () => string }).randomUUIDv7 === "function") {
      return (Bun as { randomUUIDv7: () => string }).randomUUIDv7();
    }
    return generateUuidv7();
  }
}

function generateUuidv7(): string {
  let now = Date.now();
  const msBytes = new Uint8Array(6);
  for (let i = 5; i >= 0; i--) {
    msBytes[i] = now % 256;
    now = Math.floor(now / 256);
  }
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  const bytes = new Uint8Array(16);
  bytes.set(msBytes, 0);
  bytes.set(random, 6);
  // version 7
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // variant 10xx
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
