# Decisions

The judgment calls that shaped Proof, in the order they bit. Each entry says what was chosen, what was rejected, and why.

## 1. Verification is deterministic code, never a model

The Checker is plain TypeScript comparing a freshly read snapshot against typed constraints. An LLM verdict could be argued with, prompted around, or merely wrong; a `price_at_most` predicate cannot. Models appear in exactly two places — parsing the ask into constraints (checked by predicates afterward) and the pilot's planning — and nowhere in the path that decides whether something is done.

## 2. Four constraint kinds, and nothing else

`date_equals`, `room_equals`, `price_at_most`, `unchanged(field)` — chosen because each maps to a predicate the server can evaluate and a sentence a human can read on the mismatch screen. Relative asks ("one night shorter") are resolved into absolute values at parse time. Free text never becomes a constraint.

## 3. The mismatch is emergent, not scripted

The canonical demo — quoted $294, committed $319 — is not a special case. The hotel prices by occupancy with a seeded demand schedule; the engine ticks only on mutations, so a commit honestly reprices. Seed 4 happens to produce the story; no code path knows the numbers. This is also why holds can never fill the last room: a mismatch must always be recoverable, never a dead end.

## 4. Fields the approved request changes are asked-for

Originally, a field changed with no constraint governing it was flagged as an "unexpected change." Building the recovery evals exposed the flaw: a move to a cheaper room — offered by recovery as *clean*, violating nothing — could never verify, because the room change itself counted as unexpected. The rule now: constraints permit the fields they govern, **and the staged request permits the fields it itself changes**, because those were on the review card the human approved. The price is never in the request, so a price that drifted between quote and commit still surfaces. Parser honesty rules follow the same spirit: an unrecognizable goal produces zero constraints and a plain "I could not turn that request into checkable conditions," never a guess.

## 5. The commit path is structural, not conventional

"Agents can't commit" is not a prompt instruction. The tool layer physically cannot import the transaction layer (the boundary test fails the build if it tries), the approval nonce is minted by exactly one route and never returned by any tool, and the state machine contains no transition that skips the check. The withheld-tools list is published in the inspector so the line is visible, not just enforced.

## 6. The pilot is an unprivileged stand-in

Rather than build a privileged server-side agent, the pilot replays plain HTTP against the app's own routes with cookies forwarded — it meets the same 403s and validation as a browser. It ships with a deterministic scripted engine so the demo works with zero setup and never depends on a provider; the model-backed engine is an upgrade when `OPENAI_API_KEY` exists, falling back to the playbook on any provider failure. Its tests assert the path allow-list, so "no privileges" is regression-tested, not aspiration.

## 7. State gating is expressed as tool availability

`verify_result` isn't guarded — it's absent until a change has been committed, derived from task state by the registry. An agent can't call what isn't registered, and the platform's `toolchange` event carries the evolution naturally. Absence beats guarding because there is nothing to bypass.

## 8. In-memory store, single-module seam

Demo persistence is in-memory, deterministic per seed. Everything above the store works on plain workspace values, so swapping in a durable store is a change to one module, not across the app. For a hackathon demo of a simulated hotel, reproducibility beat durability.

## 9. Copy rules: plain words, in order

No "agentic orchestration," no "multi-agent framework," no MCP lecture before its time. The homepage sells the outcome (proof of completion); "Why WebMCP?" appears only after the product is understood. Numbers in the README come from `evals/report.md` or they don't appear — never manufactured metrics

## 10. What we did not build

No real payments, no real hotel, no accounts, no mobile layout beyond responsiveness, no natural-language verification. Each was consciously out of scope: the product is the loop — plan, act, check — and the demo world only needs to be real *enough* to disagree with the plan honestly.
