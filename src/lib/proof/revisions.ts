/**
 * Compare-and-swap revision helpers (optimistic concurrency).
 *
 * Every mutation carries the revision it was planned against. If the world has
 * moved on since, the mutation is refused — the agent (or human) must re-read
 * and re-decide. This is what makes "two windows, one workspace" safe, and what
 * turns a stale staged plan into an honest "out of date" marker instead of a
 * silent overwrite.
 */

export class StaleRevisionError extends Error {
  constructor(
    /** The revision the caller planned against. */
    readonly baseRevision: number,
    /** The revision the world is actually at. */
    readonly currentRevision: number,
  ) {
    super(
      `state moved on: planned at revision ${baseRevision}, but the current revision is ${currentRevision}`,
    );
    this.name = 'StaleRevisionError';
  }
}

/**
 * Throws unless `baseRevision` is exactly the current `revision`.
 * Anything else — behind *or* ahead — is refused.
 */
export function assertCurrentRevision(baseRevision: number, revision: number): void {
  if (baseRevision !== revision) {
    throw new StaleRevisionError(baseRevision, revision);
  }
}

/** The revision a successful mutation moves the world to. */
export function nextRevision(revision: number): number {
  return revision + 1;
}
