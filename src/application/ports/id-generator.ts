/** Application-side UUIDv7 generation (§2.4). */
export abstract class IdGenerator {
  abstract nextId(): string;
}
