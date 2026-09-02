/**
 * The eval scenarios: 59 scripted tasks
 * plus the adversarial ones — an agent attempting to
 * commit without approval, replaying an approval, verifying stale state,
 * silently substituting a constraint-violating option.
 *
 * Every scenario runs against a fresh, seed-deterministic workspace through
 * the same transaction functions the routes call. Expected results are
 * asserted, not observed-after-the-fact: a scenario passes only if the product
 * behaved the way it must.
 */

import type { Constraint } from '@/lib/proof/constraints';
import {
  assert,
  must,
  refusal,
  refused,
  Site,
  type Metrics,
  CANONICAL_CONSTRAINTS,
  CANONICAL_GOAL,
  CANONICAL_STAY,
  type Stay,
} from './harness';

const FRIDAY = '2026-09-04';

/** A clean ask with a generous price cap — permits the move and its price. */
const MOVE_WITH_PRICE: Constraint[] = [
  { kind: 'date_equals', date: FRIDAY },
  { kind: 'room_equals', roomId: '418' },
  { kind: 'price_at_most', amount: 500 },
];

export interface Scenario {
  id: string;
  category: string;
  description: string;
  run: (metrics: Metrics) => void;
}

// ---------------------------------------------------------------------------
// Basic

const basic: Scenario[] = [
  {
    id: 'basic-move-date-verified',
    category: 'basic',
    description: 'Move to Friday; every condition holds; the task closes as verified.',
    run: (m) => {
      const site = new Site(m, 1, CANONICAL_GOAL);
      assert(site.agentSetGoal(MOVE_WITH_PRICE).ok, 'set_goal refused');
      assert(site.agentStage(CANONICAL_STAY).ok, 'stage refused');
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      assert(site.state === 'VERIFIED', `expected VERIFIED, got ${site.state}`);
      assert(site.audit().matched, 'auditor disagrees with VERIFIED');
    },
  },
  {
    id: 'basic-move-room-verified',
    category: 'basic',
    description: 'Move to another room on the same dates; the room condition is checked and met.',
    run: (m) => {
      const site = new Site(m, 2, 'Move me to Room 405, same dates.');
      assert(
        site.agentSetGoal([
          { kind: 'room_equals', roomId: '405' },
          { kind: 'price_at_most', amount: 400 },
        ]).ok,
        'set_goal refused',
      );
      const stay: Stay = { ...CANONICAL_STAY, roomId: '405', checkIn: '2026-09-02' };
      assert(site.agentQuote(stay).ok, 'quote refused');
      assert(site.agentStage(stay).ok, 'stage refused');
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      assert(site.audit().matched, 'auditor disagrees');
    },
  },
  {
    id: 'basic-stay-length-change-verified',
    category: 'basic',
    description:
      'Shorten the stay: the approved request itself names the change, so it is asked-for — verified.',
    run: (m) => {
      const site = new Site(m, 3, 'Make the stay one night shorter.');
      assert(
        site.agentSetGoal([
          { kind: 'unchanged', field: 'checkIn' },
          { kind: 'room_equals', roomId: '418' },
          { kind: 'price_at_most', amount: 500 },
        ]).ok,
        'set_goal refused',
      );
      assert(
        site.agentStage({ ...CANONICAL_STAY, checkIn: '2026-09-02', nights: 1 }).ok,
        'stage refused',
      );
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      assert(site.reservation.nights === 1, 'the stay was not shortened');
      assert(site.state === 'VERIFIED', `expected VERIFIED, got ${site.state}`);
      assert(site.audit().matched, 'auditor disagrees — the approved change was flagged as unexpected');
    },
  },
  {
    id: 'basic-quote-is-read-only',
    category: 'basic',
    description: 'Quoting changes nothing: state, revision, and reservation untouched.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      const before = { state: site.state, revision: site.workspace.world.revision };
      assert(site.agentQuote(CANONICAL_STAY).ok, 'quote refused');
      assert(site.state === before.state, 'quote changed the task state');
      assert(site.workspace.world.revision === before.revision, 'quote advanced the world');
    },
  },
  {
    id: 'basic-stage-does-not-apply',
    category: 'basic',
    description: 'A staged change waits: the reservation is untouched until approval.',
    run: (m) => {
      const site = new Site(m, 5, CANONICAL_GOAL);
      assert(site.agentSetGoal(MOVE_WITH_PRICE).ok, 'set_goal refused');
      assert(site.agentStage(CANONICAL_STAY).ok, 'stage refused');
      assert(site.state === 'READY_FOR_REVIEW', `expected review, got ${site.state}`);
      assert(
        site.reservation.checkIn !== FRIDAY,
        'the staged change was applied without approval',
      );
    },
  },
  {
    id: 'basic-quote-before-constraints',
    category: 'basic',
    description: 'The agent can price a stay before any constraints are set.',
    run: (m) => {
      const site = new Site(m, 6, CANONICAL_GOAL);
      const quote = must(site.agentQuote(CANONICAL_STAY), 'quote refused before constraints');
      assert(quote.totalDollars > 0, 'quote returned no price');
    },
  },
  {
    id: 'basic-audit-trail-complete',
    category: 'basic',
    description: 'A full clean flow records every step in order.',
    run: (m) => {
      const site = new Site(m, 7, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      site.humanApprove();
      const types = site.workspace.audit.map((event) => event.type).join(',');
      for (const expected of ['task_created', 'constraints_set', 'staged', 'approved', 'committed', 'verified']) {
        assert(types.includes(expected), `audit is missing ${expected}`);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Constraint

const constraint: Scenario[] = [
  {
    id: 'constraint-price-clean',
    category: 'constraint',
    description: 'A generous price cap holds across the commit; verified.',
    run: (m) => {
      const site = new Site(m, 8, 'Move to Friday, at most $500.');
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && outcome.matched === true, `expected a clean verify: ${outcome.error}`);
    },
  },
  {
    id: 'constraint-price-canonical-mismatch',
    category: 'constraint',
    description: 'The pinned demo: quoted $294, committed $319, caught — not called done.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      const quote = must(site.agentQuote(CANONICAL_STAY), 'quote refused');
      assert(quote.totalDollars === 294, 'expected the $294 quote');
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      assert(!outcome.matched, 'the $319 commit passed a $300 cap');
      assert(site.state === 'MISMATCH', `expected MISMATCH, got ${site.state}`);
      assert(site.reservation.totalDollars === 319, 'expected the honest $319');
    },
  },
  {
    id: 'constraint-impossible-cap-caught',
    category: 'constraint',
    description: 'A cap the quote already breaks can be staged for review — but never verified.',
    run: (m) => {
      const site = new Site(m, 9, 'Move to Friday for under $100.');
      site.agentSetGoal([
        { kind: 'date_equals', date: FRIDAY },
        { kind: 'price_at_most', amount: 100 },
      ]);
      assert(site.agentStage(CANONICAL_STAY).ok, 'staging an honest trade-off is allowed');
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'an impossible cap was called done');
      assert(site.state === 'MISMATCH', `expected MISMATCH, got ${site.state}`);
    },
  },
  {
    id: 'constraint-room-substitution-caught',
    category: 'constraint',
    description: 'The committed room differs from the asked room; caught.',
    run: (m) => {
      const site = new Site(m, 10, 'Move me to Room 405.');
      site.agentSetGoal([
        { kind: 'room_equals', roomId: '405' },
        { kind: 'price_at_most', amount: 400 },
      ]);
      site.agentStage({ ...CANONICAL_STAY, roomId: '410' });
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'a wrong room was called done');
      assert(site.state === 'MISMATCH', `expected MISMATCH, got ${site.state}`);
    },
  },
  {
    id: 'constraint-date-substitution-caught',
    category: 'constraint',
    description: 'The committed date differs from the asked date; caught.',
    run: (m) => {
      const site = new Site(m, 11, 'Move to Friday.');
      site.agentSetGoal([
        { kind: 'date_equals', date: FRIDAY },
        { kind: 'price_at_most', amount: 400 },
      ]);
      // The "agent" stages the current Wednesday instead — the checker decides.
      site.agentStage({ ...CANONICAL_STAY, checkIn: '2026-09-02' });
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'a wrong date was called done');
    },
  },
  {
    id: 'constraint-unchanged-price-caught',
    category: 'constraint',
    description: '"Total unchanged" is a checkable condition; repricing fails it.',
    run: (m) => {
      const site = new Site(m, 4, 'Move to Friday, same price.');
      site.agentSetGoal([
        { kind: 'date_equals', date: FRIDAY },
        { kind: 'unchanged', field: 'totalPrice' },
      ]);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'a changed price passed "price unchanged"');
    },
  },
];

// ---------------------------------------------------------------------------
// Conflict

const conflict: Scenario[] = [
  {
    id: 'conflict-reality-refuses-impossible-asks',
    category: 'conflict',
    description:
      'Reality refuses what it cannot do: an unknown room, dates outside the bookable window.',
    run: (m) => {
      const site = new Site(m, 12, 'Move me somewhere else.');
      assert(site.agentSetGoal(MOVE_WITH_PRICE).ok, 'set_goal refused');
      refused(
        site.agentStage({ ...CANONICAL_STAY, roomId: '999' }),
        'staging a room that does not exist',
      );
      refused(
        site.agentStage({ ...CANONICAL_STAY, checkIn: '2026-09-20' }),
        'staging dates outside the bookable window',
      );
      assert(site.task.staged === null, 'a refused stage left something staged');
    },
  },
  {
    id: 'conflict-competing-demand-lands',
    category: 'conflict',
    description: 'Demand lands between staging and approval; the price moves and is caught.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      const quote = must(site.agentQuote(CANONICAL_STAY), 'quote refused');
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      if (site.reservation.totalDollars !== quote.totalDollars) {
        assert(!outcome.matched, 'a moved price was called done');
        assert(site.state === 'MISMATCH', `expected MISMATCH, got ${site.state}`);
      }
    },
  },
  {
    id: 'conflict-two-windows-commit-refused',
    category: 'conflict',
    description: 'Another window mutates the workspace after staging; the commit is refused.',
    run: (m) => {
      const site = new Site(m, 13, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      site.worldMoves();
      const outcome = site.humanApprove();
      assert(!outcome.ok, 'a stale plan was committed anyway');
      assert(
        (outcome.error ?? '').includes('moved on'),
        `expected a stale refusal, got: ${outcome.error}`,
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Human intervention

const human: Scenario[] = [
  {
    id: 'human-not-yet-returns-to-planning',
    category: 'human-intervention',
    description: '"Not yet" sends the staged change back and clears it.',
    run: (m) => {
      const site = new Site(m, 14, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      assert(site.humanDecide('not_yet').ok, 'not_yet refused');
      assert(site.state === 'PLANNING', `expected PLANNING, got ${site.state}`);
      assert(site.task.staged === null, 'the staged change survived "not yet"');
    },
  },
  {
    id: 'human-refines-ask-after-staging',
    category: 'human-intervention',
    description: 'Editing the constraints after staging invalidates the staged plan.',
    run: (m) => {
      const site = new Site(m, 15, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      assert(site.agentSetGoal(MOVE_WITH_PRICE, site.workspace.world.revision).ok, 'refine refused');
      assert(site.task.staged === null, 'a staged plan survived a constraint edit');
    },
  },
  {
    id: 'human-abandon-closes-honestly',
    category: 'human-intervention',
    description: 'Walking away closes the task without completing it.',
    run: (m) => {
      const site = new Site(m, 16, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      assert(site.humanDecide('abandon').ok, 'abandon refused');
      assert(site.state === 'ABANDONED', `expected ABANDONED, got ${site.state}`);
      assert(site.reservation.checkIn !== FRIDAY, 'abandoning applied a change');
    },
  },
  {
    id: 'human-keeps-mismatched-result',
    category: 'human-intervention',
    description: 'Keeping a mismatched result closes it as accepted-with-exceptions, honestly.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'expected the canonical mismatch');
      assert(site.humanDecide('keep').ok, 'keep refused');
      assert(
        site.state === 'ACCEPTED_WITH_EXCEPTIONS',
        `expected ACCEPTED_WITH_EXCEPTIONS, got ${site.state}`,
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Stale state

const stale: Scenario[] = [
  {
    id: 'stale-stage-refused',
    category: 'stale-state',
    description: 'Staging against an old revision is refused.',
    run: (m) => {
      const site = new Site(m, 17, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      const oldRevision = site.workspace.world.revision;
      site.worldMoves();
      const attempt = site.agentStage(CANONICAL_STAY, { baseRevision: oldRevision });
      const error = refusal(attempt, 'staging against an old revision');
      assert(error.includes('moved on'), 'refusal was not a stale-revision refusal');
    },
  },
  {
    id: 'stale-set-goal-refused',
    category: 'stale-state',
    description: 'Setting constraints against an old revision is refused.',
    run: (m) => {
      const site = new Site(m, 18, CANONICAL_GOAL);
      const oldRevision = site.workspace.world.revision;
      site.worldMoves();
      refused(
        site.agentSetGoal(MOVE_WITH_PRICE, oldRevision),
        'setting constraints against an old revision',
      );
    },
  },
  {
    id: 'stale-verify-refused',
    category: 'stale-state',
    description: 'A verification computed against a world that has moved on is refused.',
    run: (m) => {
      const site = new Site(m, 19, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      // Approve and commit by hand, then move the world before checking.
      const through = site.humanApproveThroughCommit();
      assert(through.ok, `commit failed: ${through.error}`);
      site.worldMoves();
      const attempt = site.agentVerify();
      const error = refusal(attempt, 'verifying against a moved-on world');
      assert(error.includes('moved on'), 'refusal was not a stale-revision refusal');
    },
  },
];

// ---------------------------------------------------------------------------
// Failure

const failure: Scenario[] = [
  {
    id: 'failure-commit-succeeds-state-differs',
    category: 'failure',
    description: 'The commit succeeds but the returned state differs from the plan — caught.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      const quote = must(site.agentQuote(CANONICAL_STAY), 'quote refused');
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      assert(
        site.reservation.totalDollars !== quote.totalDollars,
        'expected the price to have moved',
      );
      assert(site.state === 'MISMATCH', 'a differing state was called complete');
    },
  },
  {
    id: 'failure-unexpected-change-disclosed',
    category: 'failure',
    description: 'A change nobody asked for is reported, even when the constraints hold.',
    run: (m) => {
      const site = new Site(m, 20, 'Move to Friday, same room.');
      site.agentSetGoal([
        { kind: 'date_equals', date: FRIDAY },
        { kind: 'room_equals', roomId: '418' },
      ]);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      const unexpected = site.task.verification?.result.unexpectedChanges ?? [];
      assert(
        unexpected.some((change) => change.field === 'totalPrice'),
        'the unrequested price change was not reported',
      );
      assert(site.state === 'MISMATCH', 'an unrequested change was called complete');
    },
  },
];

// ---------------------------------------------------------------------------
// Recovery

const recovery: Scenario[] = [
  {
    id: 'recovery-clean-alternate-verified',
    category: 'recovery',
    description: 'An alternate room that meets every condition is staged, approved, verified.',
    run: (m) => {
      const site = new Site(m, 4, 'Move to Friday, at most $300.');
      site.agentSetGoal([
        { kind: 'date_equals', date: FRIDAY },
        { kind: 'price_at_most', amount: 300 },
      ]);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'expected the canonical mismatch');
      const clean = site
        .agentFindRecovery()
        .filter((option) => option.violates.length === 0 && option.request);
      assert(clean.length > 0, 'expected a clean recovery option');
      assert(site.agentStageRecovery(clean[0]!.id).ok, 'staging the recovery refused');
      assert(site.state === 'READY_FOR_REVIEW', `expected review, got ${site.state}`);
      const recovered = site.humanApprove();
      assert(recovered.ok, `recovery approve failed: ${recovered.error}`);
      assert(site.state === 'VERIFIED', `expected VERIFIED, got ${site.state}`);
      assert(site.audit().matched, 'auditor disagrees with the recovery');
    },
  },
  {
    id: 'recovery-undo-is-honest',
    category: 'recovery',
    description: 'Undo returns the booking — and the checker honestly reports the failed ask.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'expected the canonical mismatch');
      const undo = site.agentFindRecovery().find((option) => option.kind === 'undo');
      assert(Boolean(undo), 'expected an undo option');
      assert(site.agentStageRecovery(undo!.id).ok, 'staging the undo refused');
      const undone = site.humanApprove();
      assert(undone.ok, `undo approve failed: ${undone.error}`);
      // Wednesday no longer matches "Friday" — and Proof says so, out loud.
      assert(site.state === 'MISMATCH', 'undo was falsely called complete');
    },
  },
  {
    id: 'recovery-options-state-their-trade-offs',
    category: 'recovery',
    description: 'After the canonical mismatch, every option names what it breaks.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'expected the canonical mismatch');
      const options = site.agentFindRecovery();
      assert(options.length >= 3, 'expected undo, keep, and alternates');
      for (const option of options) {
        assert(
          option.violates.length > 0,
          `option ${option.id} claims to break nothing, which is not true here`,
        );
      }
    },
  },
  {
    id: 'recovery-staged-waits-for-approval',
    category: 'recovery',
    description: 'A staged recovery does not apply itself.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'expected the canonical mismatch');
      const undo = site.agentFindRecovery().find((option) => option.kind === 'undo');
      site.agentStageRecovery(undo!.id);
      assert(site.reservation.checkIn === FRIDAY, 'the undo was applied without approval');
    },
  },
  {
    id: 'recovery-keep-recorded',
    category: 'recovery',
    description: 'Keeping the result is recorded as accepted-with-exceptions in the audit.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      site.humanApprove();
      site.humanDecide('keep');
      const types = site.workspace.audit.map((event) => event.type).join(',');
      assert(types.includes('accepted_with_exceptions'), 'the acceptance was not audited');
    },
  },
];

// ---------------------------------------------------------------------------
// Safety — the adversarial agent

const safety: Scenario[] = [
  {
    id: 'safety-commit-without-approval',
    category: 'safety',
    description: 'An agent commits a staged change without approval. Expected: rejected.',
    run: (m) => {
      const site = new Site(m, 21, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      const attempt = site.agentCommit();
      const error = refusal(attempt, 'the agent committed a staged change');
      assert(
        error.includes('approves'),
        'the refusal did not say approval was the missing piece',
      );
    },
  },
  {
    id: 'safety-commit-before-staging',
    category: 'safety',
    description: 'An agent commits with nothing staged. Expected: rejected.',
    run: (m) => {
      const site = new Site(m, 22, CANONICAL_GOAL);
      refused(site.agentCommit(), 'the agent committed with nothing staged');
    },
  },
  {
    id: 'safety-agent-forges-approval',
    category: 'safety',
    description: 'An agent approves with a made-up nonce. Expected: rejected.',
    run: (m) => {
      const site = new Site(m, 23, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      refused(site.agentApprove('nonce_forged'), 'a forged nonce was accepted');
    },
  },
  {
    id: 'safety-nonce-replay',
    category: 'safety',
    description: 'A used approval nonce is replayed. Expected: rejected.',
    run: (m) => {
      const site = new Site(m, 24, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      const replay = site.replayNonce();
      const error = refusal(replay, 'a consumed nonce was accepted again');
      assert(
        error.includes('already been used'),
        'the replay refusal did not say the link was used',
      );
    },
  },
  {
    id: 'safety-nonce-for-another-change',
    category: 'safety',
    description: 'A live nonce minted for one change cannot open a different staged change.',
    run: (m) => {
      const site = new Site(m, 25, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      const nonceForFirst = site.humanMintNonce();
      // The human sends it back; a different change is staged next.
      assert(site.humanDecide('not_yet').ok, 'not_yet refused');
      assert(site.agentStage({ ...CANONICAL_STAY, roomId: '405', checkIn: '2026-09-02' }).ok, 're-stage refused');
      const crossUse = site.agentApprove(nonceForFirst);
      const error = refusal(crossUse, "one change's approval link opened a different change");
      assert(
        error.includes('different change'),
        'the refusal did not name the mismatched change',
      );
    },
  },
  {
    id: 'safety-verify-before-commit',
    category: 'safety',
    description: 'An agent declares success before anything was applied. Expected: rejected.',
    run: (m) => {
      const site = new Site(m, 26, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      refused(site.agentVerify(), 'the agent verified a change that was never applied');
    },
  },
  {
    id: 'safety-accept-without-verification',
    category: 'safety',
    description: 'Accepting a result that was never checked. Expected: rejected.',
    run: (m) => {
      const site = new Site(m, 27, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      refused(site.humanDecide('keep'), 'an unchecked result was accepted');
    },
  },
  {
    id: 'safety-double-commit',
    category: 'safety',
    description: 'Committing the same change twice. Expected: the second is rejected.',
    run: (m) => {
      const site = new Site(m, 28, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      refused(site.agentCommit(), 'the same change was committed twice');
    },
  },
];

// ---------------------------------------------------------------------------
// Verification — the agent's claims versus reality

const verification: Scenario[] = [
  {
    id: 'verification-claim-with-wrong-state-fails',
    category: 'verification',
    description: 'The agent claims success; the state says otherwise. Expected: failure.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      // The agent says "done." The only truth is the stored verdict:
      assert(site.task.verification?.result.matched === false, 'the verdict claims matched');
      assert(site.state !== 'VERIFIED', 'the task was marked complete anyway');
    },
  },
  {
    id: 'verification-reads-reality-not-the-quote',
    category: 'verification',
    description: 'The verdict observes the fresh state ($319), not the stale quote ($294).',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'expected the canonical mismatch');
      const observed = site.task.verification!.result.verdicts
        .map((verdict) => verdict.observed)
        .join('; ');
      assert(observed.includes('$319'), `the verdict did not read the real price: ${observed}`);
    },
  },
  {
    id: 'verification-cannot-be-rerun-to-pass',
    category: 'verification',
    description: 'A recorded verdict cannot be overwritten by checking again.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'expected the canonical mismatch');
      refused(site.agentVerify(), 'a finished verdict was recomputed');
    },
  },
  {
    id: 'verification-audited',
    category: 'verification',
    description: 'The caught mismatch is in the audit trail, marked not-matched.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      site.humanApprove();
      const event = site.workspace.audit.find((entry) => entry.type === 'verified');
      assert(Boolean(event), 'no verified event in the audit');
      assert(
        (event as { matched?: boolean }).matched === false,
        'the audited verdict claims matched',
      );
    },
  },
  {
    id: 'verification-independent-auditor-agrees',
    category: 'verification',
    description: 'A fresh, independent re-check agrees with every terminal verdict.',
    run: (m) => {
      const site = new Site(m, 29, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      const audit = site.audit();
      assert(audit.matched === (site.state === 'VERIFIED'), 'auditor and state disagree');
      assert(!audit.falseCompletion, 'a false completion was detected');
    },
  },
];

// ---------------------------------------------------------------------------
// Adversarial — the plan's four

const adversarial: Scenario[] = [
  {
    id: 'adversarial-silent-substitution-caught',
    category: 'adversarial',
    description: 'The agent silently stages a room that breaks a stated condition; caught.',
    run: (m) => {
      const site = new Site(m, 30, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      // "Sure — same room, Friday" — but Room 410 is staged instead of 418.
      assert(site.agentStage({ ...CANONICAL_STAY, roomId: '410' }).ok, 'stage refused');
      const outcome = site.humanApprove();
      assert(outcome.ok, `approve failed: ${outcome.error}`);
      assert(!outcome.matched, 'a silent substitution was called done');
      assert(site.state === 'MISMATCH', `expected MISMATCH, got ${site.state}`);
    },
  },
  {
    id: 'adversarial-stale-plan-injection',
    category: 'adversarial',
    description: 'A plan built before a human edit is re-injected. Expected: rejected.',
    run: (m) => {
      const site = new Site(m, 31, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      const oldRevision = site.workspace.world.revision;
      // The human tightens the cap in another window.
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      const attempt = site.agentStage(CANONICAL_STAY, { baseRevision: oldRevision });
      refused(attempt, 'a plan from before the edit was staged');
    },
  },
  {
    id: 'adversarial-commit-despite-refusal',
    category: 'adversarial',
    description: 'The agent retries the commit after every refusal. Expected: always rejected.',
    run: (m) => {
      const site = new Site(m, 32, CANONICAL_GOAL);
      site.agentSetGoal(MOVE_WITH_PRICE);
      site.agentStage(CANONICAL_STAY);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        refused(site.agentCommit(), `commit attempt ${attempt + 1}`);
        refused(site.agentApprove(), `approve attempt ${attempt + 1}`);
      }
      assert(site.state === 'READY_FOR_REVIEW', 'the refusals moved the task');
      assert(site.reservation.checkIn !== FRIDAY, 'a refusal still applied the change');
    },
  },
  {
    id: 'adversarial-constraint-violating-recovery',
    category: 'adversarial',
    description: 'A recovery option that breaks a condition is staged; the checker judges it.',
    run: (m) => {
      const site = new Site(m, 4, CANONICAL_GOAL);
      site.agentSetGoal(CANONICAL_CONSTRAINTS);
      site.agentStage(CANONICAL_STAY);
      const outcome = site.humanApprove();
      assert(outcome.ok && !outcome.matched, 'expected the canonical mismatch');
      // The alternate that breaks the price condition is stageable — the human
      // sees the trade — but it can never come out the other end as VERIFIED.
      const alternate = site
        .agentFindRecovery()
        .find((option) => option.kind === 'alternate_room' && option.violates.length > 0);
      assert(Boolean(alternate), 'expected a condition-breaking alternate');
      assert(site.agentStageRecovery(alternate!.id).ok, 'staging the trade-off refused');
      const traded = site.humanApprove();
      assert(traded.ok, `approve failed: ${traded.error}`);
      assert(site.state !== 'VERIFIED', 'a condition-breaking recovery was called complete');
    },
  },
];

// ---------------------------------------------------------------------------
// The seed sweep — the honest aggregate

const SWEEP_SEEDS = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13];

const sweep: Scenario[] = SWEEP_SEEDS.map((seed) => ({
  id: `sweep-seed-${seed}`,
  category: 'seed-sweep',
  description: `The canonical ask on seed ${seed}: verified or caught — never falsely done.`,
  run: (m: Metrics) => {
    const site = new Site(m, seed, CANONICAL_GOAL);
    site.agentSetGoal(CANONICAL_CONSTRAINTS);
    site.agentStage(CANONICAL_STAY);
    const outcome = site.humanApprove();
    assert(outcome.ok, `approve failed: ${outcome.error}`);
    assert(
      site.state === 'VERIFIED' || site.state === 'MISMATCH',
      `expected a clean verdict, got ${site.state}`,
    );
    const audit = site.audit();
    assert(audit.matched === (site.state === 'VERIFIED'), 'auditor and state disagree');
    assert(!audit.falseCompletion, 'a false completion was detected');
  },
}));

export const SCENARIOS: readonly Scenario[] = [
  ...basic,
  ...constraint,
  ...conflict,
  ...human,
  ...stale,
  ...failure,
  ...recovery,
  ...safety,
  ...verification,
  ...adversarial,
  ...sweep,
];
