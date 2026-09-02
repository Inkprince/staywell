# The WebMCP surface

How Proof turns the page into a contract an agent can act on — and where that contract deliberately ends.

## The mechanism

WebMCP is a browser API: a page exposes structured tools through `document.modelContext`, and an agent on the other side (ChatGPT's in-app browser, or Chrome with the WebMCP flag enabled) discovers and executes them with typed inputs and outputs — no screenshots, no DOM scraping, no guessing which button does what.

`src/webmcp/adapter.ts` resolves whichever implementation the browser provides:

| Mode | Meaning |
| --- | --- |
| `native` | `document.modelContext` (or the pre-standard `navigator.modelContext`) exists — the platform itself owns the surface. |
| `polyfill` | No native support, so the vendored Apache-2.0 polyfill (from GoogleChromeLabs/webmcp-tools, served at `/webmcp-polyfill.js`, see `polyfill/NOTICE`) provides `registerTool` / `executeTool` in-page. |
| `unavailable` | Neither worked. The product still functions; only the agent surface is absent, and the UI says so plainly. |

## The tool set

Thirteen tools (`webmcp/schemas.ts`), each with a typed JSON schema, each executing as plain HTTP against the app's own routes:

**Reads** — `get_task`, `get_reservation`, `get_availability`, `get_constraints`, `get_task_history`, `get_verification`.
**Planning** — `set_goal` (natural language in, typed constraints out, parsed server-side), `refine_constraints`, `quote_change`, `stage_change`.
**Recovery** — `find_recovery_options`, `stage_recovery`.
**Verification** — `verify_result`.

## Gating: the tool set is derived from task state

`registry.ts` does not register a fixed list. The desired set is computed from the current task state and `sync()` converges onto it — registering, replacing, and aborting tools as the task advances, which fires the platform's `toolchange` event as a natural side effect. Concretely:

- `stage_change` exists only in the planning states.
- `verify_result` is genuinely **absent** until a change has been committed — an agent cannot even discover it early, let alone call it.
- `find_recovery_options` exists only after a caught mismatch.

A descriptor is also re-registered whenever it changes, because handlers close over task state and a stale closure would answer with stale data.

## What is deliberately withheld

`withheld.ts` names the tools that do not exist, and the list is rendered in the inspector, so anyone looking can see where the agent's authority ends:

- `approve_change` — only reachable from a real click, using a one-time token no tool ever returns.
- `commit_change` — performed by the application after approval; an agent can stage, not apply.
- `set_verified` — nothing declares its own success; the application re-reads its own state.
- `edit_constraints_silently` — constraints belong to the person who set them.

This absence is structural, not conventional: `tests/boundaries.test.ts` fails the build if anything reachable from `src/webmcp/` can call the commit or approval paths, and the tool layer physically cannot import them.

## Observation

Every call is wrapped (`registry.ts`) so results leave as the same MCP-style envelope — a text block carrying a compact JSON rendering for language models, plus `structuredContent` for richer clients — and every call lands in an in-page log the inspector renders: what the agent asked, what the page answered, and how long it took. Failures return as readable error envelopes rather than rejected promises, because an agent can act on a message.

The inspector itself is public at **`/agent-check`** — no secrets, just the current mode, the registered tool set, the withheld list, and the call log. It is the fastest way to see the surface working in any browser.

## The pilot is a client of this contract

The built-in agent (`src/lib/pilot`) is deliberately built as a stand-in for an external agent: it speaks plain HTTP to the same routes with the caller's cookies forwarded — same origin checks, same validation, same refusals. Its test suite asserts it never touches `/approve`, `/decide`, or a verify, so the demo path and the WebMCP path enforce the same line: the agent can read, plan, quote, and stage. Applying and checking are the application's, approving is the human's.
