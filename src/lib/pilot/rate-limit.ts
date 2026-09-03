/**
 * Pilot rate limiting.
 *
 * The pilot runs on our model-provider keys behind a public URL, so two
 * guards: a per-IP token bucket (burst tolerance, slow refill) and a global
 * daily cap on model-backed runs, one allowance per provider. When either
 * trips — or no key is set — the route falls back to the deterministic
 * scripted pilot, so a judge never meets a dead demo.
 *
 * In-memory, like the store: fine for a single-instance demo deployment; the
 * Supabase migration moves these counters to Postgres.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimits {
  /** Requests per IP that refill per second (bucket capacity is per-minute). */
  perMinute: number;
  /** OpenAI-backed pilot runs allowed globally per UTC day. */
  dailyOpenAiRuns: number;
  /** Groq-backed pilot runs allowed globally per UTC day. */
  dailyGroqRuns: number;
}

const DEFAULTS: RateLimits = {
  perMinute: Number(process.env.PILOT_RATE_PER_MINUTE ?? 6),
  dailyOpenAiRuns: Number(process.env.PILOT_DAILY_OPENAI_RUNS ?? 300),
  dailyGroqRuns: Number(process.env.PILOT_DAILY_GROQ_RUNS ?? 300),
};

function refill(bucket: Bucket, perMinute: number, now: number): void {
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(perMinute, bucket.tokens + (elapsed * perMinute) / 60);
  bucket.lastRefill = now;
}

export function checkIpRate(ip: string, limits: RateLimits = DEFAULTS): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { tokens: limits.perMinute, lastRefill: now };
  buckets.set(ip, bucket);
  refill(bucket, limits.perMinute, now);

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

// The daily counters — keyed by UTC date so they reset themselves.
let dailyCount = 0;
let dailyKey = '';

function dailyCounter(): { count: number; key: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyKey !== today) {
    dailyKey = today;
    dailyCount = 0;
  }
  return { count: dailyCount, key: dailyKey };
}

export function openAiBudgetRemains(limits: RateLimits = DEFAULTS): boolean {
  return dailyCounter().count < limits.dailyOpenAiRuns;
}

export function consumeOpenAiRun(limits: RateLimits = DEFAULTS): void {
  dailyCounter();
  dailyCount += 1;
}

// The Groq engine gets its own daily allowance, so a busy day on one provider
// cannot starve the other.
let groqDailyCount = 0;
let groqDailyKey = '';

function groqCounter(): { count: number; key: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (groqDailyKey !== today) {
    groqDailyKey = today;
    groqDailyCount = 0;
  }
  return { count: groqDailyCount, key: groqDailyKey };
}

export function groqBudgetRemains(limits: RateLimits = DEFAULTS): boolean {
  return groqCounter().count < limits.dailyGroqRuns;
}

export function consumeGroqRun(limits: RateLimits = DEFAULTS): void {
  groqCounter();
  groqDailyCount += 1;
}

/** Callers' best guess at their IP; x-forwarded-for first on Vercel. */
export function ipFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
