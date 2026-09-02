# Security posture

Proof's threat model is the point of the product: a capable agent, possibly wrong or actively adversarial, working against a site that must not let it apply changes, approve them, or mark them complete. Everything below is what stands between that agent and the reservation.

## The commit path is one road, and it starts with a human

- Every consequential mutation (`approveChange`, `commitStaged`, `verifyResult`, `acceptResult`, `declineStaged`, `abandonTask`, `stageRecovery`) lives in `lib/proof/transaction.ts` and is reachable only from route handlers.
- The tool surface (`src/webmcp`) is browser code that speaks HTTP; it cannot import the transaction layer. `tests/boundaries.test.ts` enforces the dependency direction — the "agents can't commit" guarantee is structural, not a prompt or a convention.
- The approve route requires a **one-time nonce** (`issueApprovalNonce`) that no tool response ever carries (`webmcp/withheld.ts` documents the design). Nonces are bound to task id *and* change id, single-use (`consumedAt`), valid only for a task in `READY_FOR_REVIEW`, and refused on replay or cross-use with distinct error messages. The eval suite exercises replay, forgery, and cross-change use — all refused.

## Same-origin enforcement

Mutating routes (`/api/tasks/:id/actions`, `/decide`, `/approve`, `/api/pilot`) validate the request origin against the deployment origin and refuse cross-origin POSTs with 403. The pilot route enforces this too — the built-in agent may look like a server-side caller, but it replays through the app's own origin and is subject to the same checks as a browser session.

## Input validation at the boundary

Every route parses and validates its body before the domain sees it: dates must match `YYYY-MM-DD`, nights must be integers 1–7, room ids must exist, constraint shapes are checked field-by-field, and step names are an enumerated set. Malformed input returns 400 with a human-readable message; the domain functions additionally re-check state, revision, and availability. The world refuses impossible asks (unknown rooms, dates outside the bookable window) rather than approximating them.

## Revision discipline (optimistic concurrency)

Every mutation carries a base revision; `lib/proof/revisions.ts` refuses anything built against a world that has moved on. In particular:

- a staged plan whose base revision no longer matches the world cannot be committed,
- a verification computed against a stale revision is refused outright — this is what makes "EXECUTING → VERIFIED" unreachable by any code path, and
- two windows editing the same workspace converge on refusal, not last-write-wins.

## The pilot is an untrusted client

The built-in agent has no privileges by construction:

- **Same surface.** It calls the app's own HTTP routes with the caller's cookies forwarded — it hits the same 403s, validation, and state gates as a browser session. Its test suite asserts the paths it may touch (task reads, actions, availability) and that it never calls `/approve`, `/decide`, or a verify.
- **Fixed system prompt.** The model-backed engine's instructions are constant in the code; no caller-controlled text reaches the system prompt, and the model is told plainly: "You cannot approve a change, commit a change, or declare success." Tool arguments are the only user-influenced surface, and they flow through the same route validation as everything else.
- **Bounded turns and output.** Max 12 turns, max output size per turn, JSON-only tool args.
- **Rate limits.** Per-IP token bucket (default 6 runs/min, `PILOT_RATE_PER_MINUTE`) and a global daily budget of model-backed runs (default 300, `PILOT_DAILY_OPENAI_RUNS`) so a key can never be run away with. When the budget is gone, the deterministic scripted engine serves the demo — a judge never meets a dead end, and no surprise spend is possible.

## Secrets

`OPENAI_API_KEY` is server-only (never `NEXT_PUBLIC_*`), read in the pilot route, never logged, never sent to the client. Sessions are opaque cookie ids; no personal data is collected anywhere in the product.

## Verification is server-side and takes no state on trust

The Checker (`lib/proof/verifier.ts`) is deterministic code — never a model — and receives only a freshly re-read snapshot from the caller. An agent cannot hand it a favourable picture: no tool accepts a state to verify against; the verify route re-reads the world itself. The eval suite's independent auditor re-runs the check against final state across all 59 scenarios and finds zero disagreement.

## Known limits (stated honestly)

- The store is in-memory per server process; a restart loses demo state. Acceptable for a simulated hotel, and the store is a single swappable module.
- The nonce travels over HTTP to the client in dev; production should be HTTPS (it is, on Vercel).
- Rate limiting is per server instance; a multi-instance deploy would move the counters to a shared store (`rate-limit.ts` marks the seam).
