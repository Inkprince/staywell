/**
 * The task state machine.
 *
 * Every state change in Proof goes through `transition()`. Illegal moves throw,
 * so the safety properties are structural: there is no code path — tool, route,
 * or pilot — that can walk a task from EXECUTING to VERIFIED, because the
 * transition table simply does not contain it.
 *
 * ```text
 * NEW → UNDERSTANDING → PLANNING → READY_FOR_REVIEW → APPROVED → EXECUTING
 *      → VERIFYING ── match ──→ VERIFIED
 *                   └ mismatch → RECOVERING → REPLANNING → READY_FOR_REVIEW
 * ```
 */

export const TASK_STATES = [
  'NEW',
  'UNDERSTANDING',
  'PLANNING',
  'READY_FOR_REVIEW',
  'APPROVED',
  'EXECUTING',
  'VERIFYING',
  'VERIFIED',
  'MISMATCH',
  'RECOVERING',
  'REPLANNING',
  'ACCEPTED_WITH_EXCEPTIONS',
  'ABANDONED',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export type TaskEvent =
  | 'understand' // goal set; the task is being parsed
  | 'plan' // the agent is working out a plan
  | 'stage' // a change is staged and waiting for review
  | 'request_changes' // the human asked for a different plan
  | 'revise' // the human edited constraints; the staged plan is out of date
  | 'approve' // the human approved the staged change
  | 'execute' // the approved change is being applied
  | 'execute_done' // the change was applied; time to check reality
  | 'match' // verification found the world matches the request
  | 'mismatch' // verification found it does not
  | 'recover' // recovery options are being prepared
  | 'accept' // the human chose to keep the result despite a failed constraint
  | 'replan' // the human chose a recovery: fix it, or undo it
  | 'abandon'; // the human walked away

/**
 * The transition table. Keys are the *only* legal moves; everything else is
 * refused. Note in particular what is absent:
 *
 * - no `EXECUTING → VERIFIED` (the §26 invariant),
 * - no `* → APPROVED` except from READY_FOR_REVIEW — and 'approve' is only
 *   ever reachable from a human click (see lib/proof/policy.ts),
 * - no way out of VERIFIED except nothing at all: it is terminal.
 */
const TRANSITIONS: Partial<Record<TaskEvent, readonly [TaskState, TaskState][]>> = {
  understand: [['NEW', 'UNDERSTANDING']],
  plan: [
    ['UNDERSTANDING', 'PLANNING'],
    // After the human asks for changes, or edits constraints mid-flight.
    ['READY_FOR_REVIEW', 'PLANNING'],
    ['REPLANNING', 'PLANNING'],
  ],
  stage: [
    ['PLANNING', 'READY_FOR_REVIEW'],
    ['REPLANNING', 'READY_FOR_REVIEW'],
  ],
  request_changes: [['READY_FOR_REVIEW', 'PLANNING']],
  revise: [['READY_FOR_REVIEW', 'PLANNING']],
  approve: [['READY_FOR_REVIEW', 'APPROVED']],
  execute: [
    ['APPROVED', 'EXECUTING'],
    // A recovery choice is itself an approval: the human picked it.
    ['RECOVERING', 'EXECUTING'],
  ],
  execute_done: [['EXECUTING', 'VERIFYING']],
  match: [['VERIFYING', 'VERIFIED']],
  mismatch: [['VERIFYING', 'MISMATCH']],
  recover: [['MISMATCH', 'RECOVERING']],
  accept: [
    ['MISMATCH', 'ACCEPTED_WITH_EXCEPTIONS'],
    ['RECOVERING', 'ACCEPTED_WITH_EXCEPTIONS'],
  ],
  replan: [
    ['MISMATCH', 'REPLANNING'],
    ['RECOVERING', 'REPLANNING'],
  ],
  abandon: [
    ['NEW', 'ABANDONED'],
    ['UNDERSTANDING', 'ABANDONED'],
    ['PLANNING', 'ABANDONED'],
    ['READY_FOR_REVIEW', 'ABANDONED'],
    ['MISMATCH', 'ABANDONED'],
    ['RECOVERING', 'ABANDONED'],
    ['REPLANNING', 'ABANDONED'],
  ],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: TaskState,
    readonly event: TaskEvent,
  ) {
    super(`illegal transition: ${from} --${event}--> is not allowed`);
    this.name = 'IllegalTransitionError';
  }
}

/** Terminal states. Once reached, no event may leave. */
export const TERMINAL_STATES: readonly TaskState[] = [
  'VERIFIED',
  'ACCEPTED_WITH_EXCEPTIONS',
  'ABANDONED',
];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Every legal `(from, to)` pair, for documentation and exhaustive testing. */
export function legalMoves(): readonly [TaskState, TaskState][] {
  return Object.values(TRANSITIONS).flat();
}

/**
 * Applies `event` to `state`, returning the next state.
 * @throws IllegalTransitionError when the move is not in the table.
 */
export function transition(state: TaskState, event: TaskEvent): TaskState {
  if (isTerminal(state)) {
    throw new IllegalTransitionError(state, event);
  }

  const moves = TRANSITIONS[event] ?? [];
  const move = moves.find(([from]) => from === state);

  if (!move) {
    throw new IllegalTransitionError(state, event);
  }

  return move[1];
}

/**
 * Non-throwing form, for guards and UI affordances: can this event fire now?
 */
export function canTransition(state: TaskState, event: TaskEvent): boolean {
  if (isTerminal(state)) return false;
  const moves = TRANSITIONS[event] ?? [];
  return moves.some(([from]) => from === state);
}
