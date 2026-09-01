/**
 * Append-only audit events.
 *
 * Every consequential thing that happens is recorded, in order, forever. The
 * store only ever appends to this list; there is no update and no delete. The
 * receipt, the timeline, and the evals all read from here.
 */

export type AuditEvent =
  | { type: 'task_created'; taskId: string; goal: string; at: string }
  | { type: 'constraints_set'; taskId: string; constraints: unknown[]; at: string }
  | { type: 'quoted'; taskId: string; quote: unknown; at: string }
  | { type: 'staged'; taskId: string; change: unknown; at: string }
  | { type: 'approved'; taskId: string; changeId: string; nonceId: string; at: string }
  | { type: 'committed'; taskId: string; changeId: string; outcome: unknown; at: string }
  | { type: 'verified'; taskId: string; matched: boolean; result: unknown; at: string }
  | {
      type: 'recovery_offered';
      taskId: string;
      options: unknown[];
      at: string;
    }
  | { type: 'accepted_with_exceptions'; taskId: string; at: string }
  | { type: 'state_changed'; taskId: string; from: string; to: string; at: string };

/** Every event carries its timestamp; this is the only clock in the system. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Appends `event` to `log` immutably. Nothing else in the codebase touches
 * audit logs except through this function — there is no path that edits or
 * rewrites history.
 */
export function appendAudit<T extends AuditEvent>(log: readonly AuditEvent[], event: T): AuditEvent[] {
  return [...log, event];
}
