/**
 * Pilot rate limiting.
 *
 * The pilot runs on our OpenAI key behind a public URL, so two guards:
 * a per-IP token bucket (burst tolerance, slow refill) and a global daily
 * cap on OpenAI-backed runs. When either trips — or the key is absent — the
 * route falls back to the deterministic scripted pilot, so a judge never
 * meets a dead demo.
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
}

const DEFAULTS: RateLimits = {
  perMinute: Number(process.env.PILOT_RATE_PER_MINUTE ?? 6),
  dailyOpenAiRuns: Number(process.env.PILOT_DAILY_OPENAI_RUNS ?? 300),
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

// The daily counter — keyed by UTC date so it resets itself.
let dailyCount = 0;
let dailyKey = '';

export function openAiBudgetRemains(limits: RateLimits = DEFAULTS): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyKey !== today) {
    dailyKey = today;
    dailyCount = 0;
  }
  return dailyCount < limits.dailyOpenAiRuns;
}

export function consumeOpenAiRun(limits: RateLimits = DEFAULTS): void {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyKey !== today) {
    dailyKey = today;
    dailyCount = 0;
  }
  dailyCount += 1;
}

/** Callers' best guess at their IP; x-forwarded-for first on Vercel. */
export function ipFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
