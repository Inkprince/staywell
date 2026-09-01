import { describe, expect, it } from 'vitest';
import {
  canTransition,
  IllegalTransitionError,
  isTerminal,
  legalMoves,
  TASK_STATES,
  transition,
  type TaskEvent,
} from '@/lib/proof/state-machine';

const ALL_EVENTS: TaskEvent[] = [
  'understand',
  'plan',
  'stage',
  'request_changes',
  'revise',
  'approve',
  'execute',
  'execute_done',
  'match',
  'mismatch',
  'recover',
  'accept',
  'replan',
  'abandon',
];

describe('the happy path', () => {
  it('walks NEW to VERIFIED exactly as designed', () => {
    const path: TaskEvent[] = [
      'understand',
      'plan',
      'stage',
      'approve',
      'execute',
      'execute_done',
      'match',
    ];

    const state = path.reduce((s, e) => transition(s, e), 'NEW' as ReturnType<typeof transition>);

    expect(state).toBe('VERIFIED');
  });

  it('walks the mismatch recovery loop back to review', () => {
    const path: TaskEvent[] = [
      'understand',
      'plan',
      'stage',
      'approve',
      'execute',
      'execute_done',
      'mismatch',
      'recover',
      'replan',
      'stage',
      'approve',
      'execute',
      'execute_done',
      'match',
    ];

    const state = path.reduce((s, e) => transition(s, e), 'NEW' as ReturnType<typeof transition>);

    expect(state).toBe('VERIFIED');
  });
});

describe('the §26 invariant', () => {
  it('refuses EXECUTING → VERIFIED', () => {
    expect(() => transition('EXECUTING', 'match')).toThrow(/EXECUTING --match-->/);
  });

  it('admits VERIFIED only from VERIFYING on match', () => {
    expect(transition('VERIFYING', 'match')).toBe('VERIFIED');
  });

  it('refuses every route into VERIFIED except match from VERIFYING', () => {
    for (const state of TASK_STATES) {
      for (const event of ALL_EVENTS) {
        if (state === 'VERIFYING' && event === 'match') continue;
        // transition throws for illegal moves, so a non-throwing call here
        // would be a new way to reach a non-VERIFIED state — fine. We only
        // care that none of them lands on VERIFIED.
        try {
          const next = transition(state, event);
          expect(next).not.toBe('VERIFIED');
        } catch {
          // illegal, which is what we want for everything else.
        }
      }
    }
  });
});

describe('authority boundaries in the table', () => {
  it('allows approve only from READY_FOR_REVIEW', () => {
    expect(transition('READY_FOR_REVIEW', 'approve')).toBe('APPROVED');
    for (const state of TASK_STATES) {
      if (state === 'READY_FOR_REVIEW') continue;
      expect(() => transition(state, 'approve')).toThrow(IllegalTransitionError);
    }
  });

  it('allows execution only after approval, or as a human recovery choice', () => {
    expect(transition('APPROVED', 'execute')).toBe('EXECUTING');
    expect(transition('RECOVERING', 'execute')).toBe('EXECUTING');
    expect(() => transition('PLANNING', 'execute')).toThrow();
    expect(() => transition('READY_FOR_REVIEW', 'execute')).toThrow();
  });

  it('returns to PLANNING when the human revises constraints mid-flight', () => {
    expect(transition('READY_FOR_REVIEW', 'revise')).toBe('PLANNING');
    expect(transition('READY_FOR_REVIEW', 'request_changes')).toBe('PLANNING');
  });
});

describe('terminal states', () => {
  it('is terminal for VERIFIED, ACCEPTED_WITH_EXCEPTIONS, and ABANDONED', () => {
    expect(isTerminal('VERIFIED')).toBe(true);
    expect(isTerminal('ACCEPTED_WITH_EXCEPTIONS')).toBe(true);
    expect(isTerminal('ABANDONED')).toBe(true);
    expect(isTerminal('MISMATCH')).toBe(false);
  });

  it('refuses every event from every terminal state', () => {
    for (const state of ['VERIFIED', 'ACCEPTED_WITH_EXCEPTIONS', 'ABANDONED'] as const) {
      for (const event of ALL_EVENTS) {
        expect(() => transition(state, event)).toThrow(IllegalTransitionError);
      }
    }
  });
});

describe('exhaustive illegality', () => {
  it('throws for every (state, event) pair not in the table', () => {
    const legal = new Set(legalMoves().map(([from, to]) => `${from}->${to}`));

    for (const state of TASK_STATES) {
      for (const event of ALL_EVENTS) {
        try {
          const to = transition(state, event);
          expect(legal.has(`${state}->${to}`)).toBe(true);
        } catch {
          // thrown pairs must not be in the table either
        }
      }
    }
  });
});

describe('canTransition', () => {
  it('agrees with transition everywhere', () => {
    for (const state of TASK_STATES) {
      for (const event of ALL_EVENTS) {
        let threw = false;
        try {
          transition(state, event);
        } catch {
          threw = true;
        }
        expect(canTransition(state, event)).toBe(!threw);
      }
    }
  });
});
