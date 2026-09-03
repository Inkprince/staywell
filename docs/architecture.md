# Architecture

Proof is a Next.js application (App Router, Turbopack) with one deliberate shape: **the domain is engine-agnostic, the agent surface is thin, and the two never mix.** This document walks the layers inward, then follows one task through the whole loop.

## The layering rule

Four layers, one-way dependencies, enforced by `tests/boundaries.test.ts`:

```text
src/webmcp/tools.ts      the agent surface — browser code, speaks HTTP only
        │
        ▼  (HTTP, never imports)
src/lib/http             route-level helpers: sessions, same-origin, task views
src/app/api/**           route handlers: parse, authorize, delegate
        │
        ▼
src/lib/proof            the domain: state machine, constraints, transactions,
        │                revisions, verifier, recovery, audit
        ▼
src/lib/staywell         the simulated hotel: seeded demand, yield pricing
```

- `lib/proof` never imports from `lib/staywell`'s routes or from `webmcp` — it knows the world only through the interfaces it's handed.
- `webmcp/tools.ts` is *browser* code: it speaks HTTP to the route handlers and imports nothing from `lib/proof`. That is what makes "no agent can approve or commit" structural rather than promised — the code that could approve simply is not reachable from the tool surface, and the boundary test fails the build if anyone wires it up.
- The commit path runs only from `src/app/api/tasks/[taskId]/approve/route.ts`, which requires the one-time nonce only the human's browser is issued.

## The domain (`src/lib/proof`)

**`state-machine.ts`** — 13 states, one transition table, illegal moves throw:

```text
NEW → UNDERSTANDING → PLANNING → READY_FOR_REVIEW → APPROVED → EXECUTING
     → VERIFYING ── match ──→ VERIFIED
                  └ mismatch → MISMATCH → (recover → RECOVERING → replan → REPLANNING → READY_FOR_REVIEW)
                              └ accept  → ACCEPTED_WITH_EXCEPTIONS
```

What is absent is the point: no `EXECUTING → VERIFIED` (you cannot skip the check), no `* → APPROVED` except from `READY_FOR_REVIEW`, and no way out of a terminal state. `VERIFIED`, `ACCEPTED_WITH_EXCEPTIONS`, and `ABANDONED` are terminal.

**`constraints.ts`** — the ask as predicates, never free text. Four kinds: `date_equals`, `room_equals`, `price_at_most`, `unchanged(field)`. An agent cannot argue with a predicate; it either holds against observed state or it doesn't.

**`transaction.ts`** — the loop as pure functions over an immutable workspace: `startTask`, `setConstraints`, `getQuote` (read-only), `stageChange`, `issueApprovalNonce`, `approveChange`, `commitStaged`, `verifyResult`, `stageRecovery`, `acceptResult`, `declineStaged`, `abandonTask`. Each returns a new workspace; the caller persists. Two invariants live here:

- **One-time approvals.** `approveChange` requires a nonce that `issueApprovalNonce` mints — bound to task *and* change id, consumed on use, refused on replay or cross-use. Only the server-side approve route ever mints one, and only for a task in `READY_FOR_REVIEW`.
- **Optimistic concurrency.** Every mutation carries a `baseRevision`; `revisions.ts` refuses anything built against a world that has moved on ("state moved on: planned at revision X, but the current revision is Y"). The commit re-checks the staged plan's base revision; the verify re-checks the task's revision. This is what makes a stale plan uncommittable and a stale verdict impossible.

**`verifier.ts`** — the Checker. Deterministic, never an LLM, takes no state on trust: the caller re-reads the world and hands it a fresh snapshot. It answers two questions: does every constraint hold, and did anything *else* change? Fields are "permitted" when a constraint governs them (a `date_equals` implies the date may move) **or when the staged request itself changes them** — those were on the review card the human approved, so they are asked-for. The price is never in the request, so a price that moved between quote and commit always surfaces. `matched` is true only when both answers are clean.

**`recovery.ts`** — after a caught mismatch, computes the menu: keep the change, undo it, or move to another room — each annotated with exactly which constraints it satisfies and which it violates. An option that violates anything requires explicit human choice; nothing is auto-selected.

**`audit.ts`** — an append-only event log per workspace: `task_created`, `constraints_set`, `staged`, `approved` (with nonce id), `committed` (with the freshly re-read outcome), `verified` (with the full verdict), `recovery_offered`, `accepted_with_exceptions`. The receipt screen renders this trail.

## The simulated hotel (`src/lib/staywell`)

A deterministic world, seeded (`rng.ts`, mulberry32). Twenty-five rooms across three tiers; a calendar week; occupancy-driven yield pricing with four tiers (quiet → high demand, multiplier 1.0 → 1.3). Competing demand is a **seeded schedule of holds** that lands as the engine advances — the engine ticks only on mutating calls, so a quote is read-only and a commit can honestly reprice. Holds may never fill the last room, so a mismatch is always about price, never a dead end.

Booking has a checkout: a fresh reservation is **held** (the room is honestly taken) and becomes **confirmed** when the guest picks one of the demo payment methods (`payReservation` — every method is simulated, nothing is charged; the paid/unpaid state is real and visible). Payment bumps the world revision like any other mutation, so a change staged against the unpaid world is honestly stale. A change of plan is not a payment event: amending a held reservation keeps it held.

The canonical demo is emergent, not scripted: on seed 4 the quote is $294 at occupancy 0.72 (busy), and by commit time holds have landed and the same formula yields $319 (high demand). No special case in the code knows this number.

## The WebMCP surface (`src/webmcp`)

See [webmcp.md](webmcp.md) for the full contract. In short: `registry.ts` derives the tool set from task state (so `verify_result` is genuinely *absent* until something was committed), `tools.ts` builds each tool to speak plain HTTP, `withheld.ts` keeps the approval nonce out of every tool response, and the polyfill (vendored, Apache-2.0, see `src/webmcp/polyfill/NOTICE`) provides `document.modelContext` in browsers that don't ship it natively.

## The pilot (`src/lib/pilot`, `src/app/api/pilot`)

The built-in **fallback** agent, so the demo needs no external agent — designed as a stand-in for exactly what an external agent can do, with no privileges, and clearly labelled as a fallback wherever the UI shows it (it runs server-side over HTTP, so its steps never appear in the WebMCP call log):

- It talks plain HTTP to the app's own API routes (`forwardClient` replays requests from the server's own origin with the caller's cookies forwarded), so it meets the same 403s, the same validation, and the same gates as a browser session. The scripted test suite asserts this: only the read/plan/recover endpoints, never `/approve`, never `/decide`, never a verify.
- Two engines: a deterministic scripted playbook (`scripted.ts` — regex constraint parsing with honest "I could not turn that request into checkable conditions" refusal) and, when `OPENAI_API_KEY` is set and a daily budget remains, the OpenAI Responses API (`openai.ts`) with a fixed system prompt — "You cannot approve a change, commit a change, or declare success" — falling back to the playbook on any provider failure. A third engine, `groq.ts`, plays the same role on Groq's `openai/gpt-oss-20b` behind `GROQ_API_KEY` (used when no OpenAI key or budget is available); the fixed prompt, tool surface, and HTTP-only execution are shared in `engine-tools.ts`, so the engine choice changes the model, never the powers. None of them is the verifier — checking stays deterministic.
- Guard rails: per-IP token bucket (default 6/min), a global daily run cap per provider (default 300 each), same-origin enforcement, streamed as NDJSON so the UI shows each step as it happens.

## The evals (`evals/`)

`harness.ts` drives fresh seed-deterministic workspaces through the *same transaction functions the routes call*, with an agent surface (exactly what tools can reach) and a human surface (exactly what the browser gates). `scenarios.ts` holds 59 scenarios; `evals.test.ts` asserts the two global properties — zero false completions, total enforcement — and writes `report.json` / `report.md`. Only those measured numbers reach the README.

## Storage

Sessions are cookie-scoped; the workspace store is in-memory (recreated per server process, deterministic per seed). The store is a single module (`lib/store/memory.ts`) deliberately: everything above it works on plain workspace values, so a persistent store is a change in that one file, not across the app (`workspace-access.ts` and `rate-limit.ts` carry the same seam for session data and counters).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · pnpm · Vitest.
