/**
 * The scripted pilot — the deterministic fallback engine, and the floor under
 * the demo: no API key, no budget, no network beyond our own routes.
 *
 * It has **no special privileges**. Like the browser's tool surface, it speaks
 * only HTTP to the route handlers; it cannot approve, commit, or verify
 * anything the routes wouldn't let a browser do. If it misbehaves, the same
 * 403s and 409s answer it.
 */

import type { Constraint } from '@/lib/proof/constraints';

// ---------------------------------------------------------------------------
// The client every engine uses: plain HTTP, cookie-authenticated, no back door.

export interface PilotClient {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

export interface PilotStep {
  /** What the pilot did, in one human sentence. */
  note: string;
  /** The route it called, when it called one. */
  path?: string;
  outcome: 'ok' | 'error' | 'needs-you';
  detail?: unknown;
}

export interface PilotRun {
  engine: 'scripted' | 'openai';
  steps: PilotStep[];
  /** Where the task ended up, as the pilot last saw it. */
  finalState?: string;
}

type Run = AsyncGenerator<PilotStep, void, unknown>;

// ---------------------------------------------------------------------------
// Deterministic goal parsing: the StayWell demo vocabulary, in plain words.

const CALENDAR_START = '2026-09-01'; // a Tuesday
const CALENDAR_DAYS = 7;

const WEEKDAYS = [
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'monday',
] as const;

function dateForWeekday(weekday: string): string | null {
  const index = WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]);
  if (index < 0) return null;
  const date = new Date(`${CALENDAR_START}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  const iso = date.toISOString().slice(0, 10);
  return index < CALENDAR_DAYS ? iso : null;
}

const NIGHT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

export interface ParsedGoal {
  constraints: Constraint[];
  stay: { checkIn?: string; roomId?: string; nights?: number };
  /** The human asked for some other room ("a quieter room"). */
  wantsDifferentRoom: boolean;
  understood: string[];
}

function nightCountFrom(word: string): number | undefined {
  if (word in NIGHT_WORDS) return NIGHT_WORDS[word]!;
  const digits = Number(word);
  return Number.isInteger(digits) && digits > 0 ? digits : undefined;
}

/**
 * Parses the human's words into typed constraints and a stay request.
 * Deliberately transparent: every constraint it produces is traceable to a
 * phrase in the goal, and anything it cannot type, it ignores — the
 * checker only ever judges predicates the server can evaluate.
 *
 * Two rules keep it honest:
 * - A field only becomes an `unchanged` constraint when the human's ask
 *   leaves it untouched ("the same nights", "keep my room"). An absolute
 *   ask ("two nights") is a change, not a constraint.
 * - The dates are only marked unchanged when the whole ask is about
 *   something else (a room, a length) — never invented.
 */
export function parseGoal(
  goal: string,
  current: { checkIn: string; roomId: string; nights: number },
): ParsedGoal {
  const text = goal.toLowerCase();
  const constraints: Constraint[] = [];
  const stay: ParsedGoal['stay'] = {};
  const understood: string[] = [];
  let wantsDifferentRoom = false;

  // The date: a weekday in the demo window, or an explicit date.
  const explicitDate = goal.match(/\d{4}-\d{2}-\d{2}/);
  const weekday = text.match(/\b(tuesday|wednesday|thursday|friday|saturday|sunday|monday)\b/);
  if (explicitDate) {
    stay.checkIn = explicitDate[0];
    constraints.push({ kind: 'date_equals', date: explicitDate[0] });
    understood.push(`check in on ${explicitDate[0]}`);
  } else if (weekday) {
    const date = dateForWeekday(weekday[1]!);
    if (date) {
      stay.checkIn = date;
      constraints.push({ kind: 'date_equals', date });
      understood.push(`check in on ${weekday[1]} (${date})`);
    }
  }

  // The room: named, "the same room", or a different room altogether.
  const namedRoom = goal.match(/\broom\s+(\d{3})\b/i);
  const sameRoom = /\b(same room|keep (my|the) room|keep it in (my|the) room)\b/.test(text);
  if (namedRoom) {
    stay.roomId = namedRoom[1]!;
    constraints.push({ kind: 'room_equals', roomId: namedRoom[1]! });
    understood.push(`stay in Room ${namedRoom[1]}`);
  } else if (sameRoom) {
    stay.roomId = current.roomId;
    constraints.push({ kind: 'room_equals', roomId: current.roomId });
    understood.push('keep the same room');
  } else if (/\b(quieter|quiet|different|another)\s+room\b/.test(text)) {
    wantsDifferentRoom = true;
    understood.push('a different room');
  }

  // Length of stay: relative first, then "the same nights", then absolute.
  const shorter = text.match(/\b(one|two|three|four|five|six|seven|a|\d)\s+nights?\s(?:shorter|less)\b/);
  const longer = text.match(/\b(one|two|three|four|five|six|seven|a|\d)\s+nights?\s(?:longer|more)\b/);
  const sameNights = /\bsame nights?\b/.test(text);
  const absolute = text.match(/\b(one|two|three|four|five|six|seven|\d)\s+nights?\b/);

  if (shorter) {
    const count = nightCountFrom(shorter[1] === 'a' ? 'one' : shorter[1]!);
    const nights = Math.max(1, current.nights - (count ?? 1));
    stay.nights = nights;
    understood.push(
      current.nights - nights === 1
        ? 'one night shorter'
        : `${current.nights - nights} nights shorter`,
    );
  } else if (longer) {
    const count = nightCountFrom(longer[1] === 'a' ? 'one' : longer[1]!);
    const nights = Math.min(7, current.nights + (count ?? 1));
    stay.nights = nights;
    understood.push(
      nights - current.nights === 1 ? 'one night longer' : `${nights - current.nights} nights longer`,
    );
  } else if (sameNights) {
    stay.nights = current.nights;
    constraints.push({ kind: 'unchanged', field: 'nights' });
    understood.push('the same nights');
  } else if (absolute) {
    const nights = nightCountFrom(absolute[1]!);
    if (nights && nights >= 1 && nights <= 7) {
      stay.nights = nights;
      understood.push(`${nights} night${nights === 1 ? '' : 's'}`);
    }
  }

  // The price ceiling.
  const price = text.match(
    /(?:under|at most|no more than|not.*more than|less than|within|up to|budget of|spend (?:more than )?)\s*\$?(\d{2,5})/,
  ) ?? text.match(/\$\s?(\d{2,5})/);
  if (price) {
    const amount = Number(price[1]);
    if (Number.isFinite(amount) && amount > 0) {
      constraints.push({ kind: 'price_at_most', amount });
      understood.push(`total at most $${amount}`);
    }
  }

  // A room-only, length-only, or price-only ask leaves the dates alone — but
  // only when the ask was understood as a change at all. An ask with no
  // recognizable signal produces no constraints, and the pilot says so
  // rather than inventing a plan.
  const understoodSomething =
    Boolean(stay.checkIn || stay.roomId || stay.nights || wantsDifferentRoom) ||
    constraints.some((c) => c.kind === 'price_at_most');
  if (!stay.checkIn && understoodSomething) {
    constraints.push({ kind: 'unchanged', field: 'checkIn' });
    if (!wantsDifferentRoom && !stay.nights) understood.push('the same dates');
  }

  return { constraints, stay, wantsDifferentRoom, understood };
}

// ---------------------------------------------------------------------------
// The loop

/**
 * Drives a task as far as the pilot legitimately can:
 *
 * - UNDERSTANDING/PLANNING/REPLANNING → parse the goal, set typed
 *   constraints, quote, and stage the change for the human's review.
 * - MISMATCH/RECOVERING → find recovery options and stage one *only if it
 *   violates nothing the human asked for*. A trade is the human's to make.
 *
 * It stops at READY_FOR_REVIEW every time: approval is not the pilot's.
 */
export async function* runScriptedPilot(
  client: PilotClient,
  taskId: string,
): Run {
  const taskResponse = (await client.get(`/api/tasks/${taskId}`)) as {
    task?: {
      state: string;
      revision: number;
      goal: string;
      staged: { request: { reservationId: string } } | null;
    };
    reservation?: {
      reservationId: string;
      checkIn: string;
      roomId: string;
      nights: number;
    } | null;
    error?: string;
  };

  const task = taskResponse.task;
  if (!task) {
    yield { note: 'I could not find that task.', outcome: 'error', detail: taskResponse };
    return;
  }
  const reservation = taskResponse.reservation;
  if (!reservation) {
    yield {
      note: 'There is no reservation in this workspace to work on.',
      outcome: 'error',
    };
    return;
  }

  const planningStates = ['UNDERSTANDING', 'PLANNING', 'REPLANNING'];
  const recoveryStates = ['MISMATCH', 'RECOVERING'];

  if (planningStates.includes(task.state)) {
    yield* planAndStage(client, taskId, task, reservation);
    return;
  }

  if (recoveryStates.includes(task.state)) {
    yield* recover(client, taskId);
    return;
  }

  yield {
    note: `There is nothing for me to do right now — this task is ${task.state
      .replaceAll('_', ' ')
      .toLowerCase()}.`,
    outcome: 'ok',
  };
}

async function* planAndStage(
  client: PilotClient,
  taskId: string,
  task: { state: string; revision: number; goal: string },
  reservation: { reservationId: string; checkIn: string; roomId: string; nights: number },
): Run {
  const parsed = parseGoal(task.goal, reservation);

  if (parsed.constraints.length === 0) {
    yield {
      note: 'I could not turn that request into checkable conditions. Try naming a day, a room, or a price — or ask in your own words what you want true at the end.',
      outcome: 'needs-you',
      detail: { understood: parsed.understood },
    };
    return;
  }

  const set = (await client.post(`/api/tasks/${taskId}/actions`, {
    step: 'set_goal',
    constraints: parsed.constraints,
    baseRevision: task.revision,
  })) as { task?: { revision: number }; error?: string };

  if (!set.task) {
    yield {
      note: 'The site refused the plan — it may have moved on while I was reading it.',
      outcome: 'error',
      path: `/api/tasks/${taskId}/actions`,
      detail: set,
    };
    return;
  }
  yield {
    note: `I understood: ${parsed.understood.join(', ')}.`,
    path: `/api/tasks/${taskId}/actions`,
    outcome: 'ok',
  };

  // Where would we stay? A different-room ask means picking one — cheapest
  // available that isn't the current room; otherwise the stated (or current)
  // room on the stated (or current) dates.
  const request = {
    reservationId: reservation.reservationId,
    roomId: parsed.stay.roomId ?? reservation.roomId,
    checkIn: parsed.stay.checkIn ?? reservation.checkIn,
    nights: parsed.stay.nights ?? reservation.nights,
  };

  if (parsed.wantsDifferentRoom) {
    const availability = (await client.post('/api/availability', {
      checkIn: request.checkIn,
      nights: request.nights,
    })) as {
      rooms?: {
        roomId: string;
        available: boolean;
        quote: { totalDollars: number };
      }[];
      error?: string;
    };

    const pick = (availability.rooms ?? [])
      .filter((room) => room.available && room.roomId !== reservation.roomId)
      .sort((a, b) => a.quote.totalDollars - b.quote.totalDollars)[0];

    if (!pick) {
      yield {
        note: 'No other room is available for those dates. Nothing has been changed.',
        path: '/api/availability',
        outcome: 'needs-you',
      };
      return;
    }
    request.roomId = pick.roomId;
    yield {
      note: `Room ${pick.roomId} is available for $${pick.quote.totalDollars} — the least expensive room that is not yours.`,
      path: '/api/availability',
      outcome: 'ok',
    };
  }

  const quote = (await client.post(`/api/tasks/${taskId}/actions`, {
    step: 'quote_change',
    ...request,
  })) as { quote?: { totalDollars: number }; error?: string };

  if (!quote.quote) {
    yield {
      note: 'I could not price that stay — the site said no.',
      outcome: 'error',
      path: `/api/tasks/${taskId}/actions`,
      detail: quote,
    };
    return;
  }
  yield {
    note: `Quoted $${quote.quote.totalDollars} for Room ${request.roomId}, ${request.nights} night${request.nights === 1 ? '' : 's'} from ${request.checkIn}.`,
    path: `/api/tasks/${taskId}/actions`,
    outcome: 'ok',
    detail: quote.quote,
  };

  const staged = (await client.post(`/api/tasks/${taskId}/actions`, {
    step: 'stage_change',
    ...request,
    baseRevision: set.task.revision,
    rationale: `Move to ${request.checkIn === reservation.checkIn ? 'the current dates' : request.checkIn}, ${request.roomId === reservation.roomId ? 'same room' : `Room ${request.roomId}`}, ${request.nights} night${request.nights === 1 ? '' : 's'}.`,
  })) as { task?: { state: string }; error?: string };

  if (!staged.task) {
    yield {
      note: 'I prepared the change but the site refused to stage it — someone may have edited the plan.',
      outcome: 'error',
      path: `/api/tasks/${taskId}/actions`,
      detail: staged,
    };
    return;
  }

  yield {
    note: 'The change is ready and waiting for your decision.',
    path: `/api/tasks/${taskId}/actions`,
    outcome: 'needs-you',
  };
}

async function* recover(client: PilotClient, taskId: string): Run {
  const optionsResponse = (await client.post(`/api/tasks/${taskId}/actions`, {
    step: 'find_recovery_options',
  })) as {
    options?: {
      id: string;
      kind: string;
      summary: string;
      violates: unknown[];
    }[];
    error?: string;
  };

  const options = optionsResponse.options ?? [];
  if (options.length === 0) {
    yield {
      note: 'I could not find any ways forward. Nothing has been changed.',
      outcome: 'error',
      detail: optionsResponse,
    };
    return;
  }

  // A trade is the human's to make: only an option that violates none of the
  // stated conditions may be staged by the pilot.
  const clean = options.filter((option) => option.violates.length === 0);
  if (clean.length === 0) {
    yield {
      note: `Every way forward gives up something you asked for — ${options.length} options are laid out in the interface for your choice.`,
      path: `/api/tasks/${taskId}/actions`,
      outcome: 'needs-you',
    };
    return;
  }

  const best = clean[0]!;
  const staged = (await client.post(`/api/tasks/${taskId}/actions`, {
    step: 'stage_recovery',
    optionId: best.id,
  })) as { task?: { state: string }; error?: string };

  if (!staged.task) {
    yield {
      note: 'The site refused the recovery I picked. Nothing has been changed.',
      outcome: 'error',
      detail: staged,
    };
    return;
  }

  yield {
    note: `I prepared a way forward that meets everything you asked: ${best.summary} It waits for your approval.`,
    path: `/api/tasks/${taskId}/actions`,
    outcome: 'needs-you',
  };
}
