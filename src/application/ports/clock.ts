/** Injectable clock so tests can pin time. */
export abstract class Clock {
  abstract now(): Date;
}
