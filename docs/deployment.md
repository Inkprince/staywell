# Deploying StayWell, with Proof, for judging

How to run a live demo a judge can test in ChatGPT's in-app browser — reliably, and without anything about the deployment undermining the product's claims.

## What kind of deployment this needs

Proof is a server application: pages, plus the HTTP API the agent surface mirrors. So:

- **Node.js server or Docker** — `pnpm build && pnpm start` on any host that runs a long-lived Node process (a VM, Fly.io, Railway, Render, a Docker container). All Next.js features are supported on this path.
- **Not a static export** (no server, no API routes, no product) and **not serverless/autoscaling** — see the single-instance requirement below.
- **Public HTTPS**, because ChatGPT's in-app browser (and the native WebMCP surface inside it) needs a real origin to load. `localhost` is fine for development only.

Minimal sequence on any host with Node 20+ and pnpm:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start        # serves on :3210; put HTTPS/TLS in front of it
```

Set the port with `PORT` if your platform assigns one (`next start` honours it).

## The single-instance requirement (read this part)

Sessions, workspaces, tasks, approval nonces, and the StayWell simulation all live **in the server's memory** (`src/lib/store/memory.ts`). There is no database.

Consequences, stated plainly:

- **Run exactly one instance.** Two instances behind a load balancer means a judge's session exists on one process and their task on another — broken workspaces, unfindable approval nonces, and a demo that fails in ways that look like product bugs. Autoscaling platforms that spawn additional processes (or serverless functions, where every request may run in a fresh process — this rules out Vercel's default functions and Netlify's) will do this to you silently.
- **A restart clears everything.** Every workspace, task, and audit trail goes away. For judging this is acceptable — even useful (a fresh canonical demo seed per restart) — but do not restart mid-demo. A free-tier host that sleeps after inactivity effectively gives every cold start the canonical first-run world, which is exactly what the demo wants.
- **For a durable or multi-instance deployment**, swap the in-memory store for a shared one first. Every consumer goes through the same accessors, so that change is localised — but it is not done, and nothing in this repo should be presented as if it were.

Recommended single-instance hosts: a single Fly.io machine, a single Railway/Render service (with scaling pinned to 1), or any VM/container running one `next start` process behind TLS. On Render: New → Web Service, connect the repo, build `pnpm install --frozen-lockfile && pnpm build`, start `pnpm start`, instance count 1. The images are self-hosted under `public/images/`, so the deployment makes no calls to third-party CDNs.

## Sessions in embedded browsers

Workspace identity is a cookie (`proof_w`), and the API also accepts the workspace id as a `?w=` parameter. In practice ChatGPT's in-app browser keeps cookies for the sites you visit, so a judge's session simply works; the `?w=` parameter is the escape hatch for API-level access if you ever need it. If a judge ever reports an empty session, the fix is not a URL — it is opening the site in ChatGPT's browser again (or Chrome with WebMCP enabled), which mints a fresh workspace with the canonical demo world automatically.

## Environment

| Variable | Required | Effect |
| --- | --- | --- |
| `OPENAI_API_KEY` | no | Switches the built-in fallback pilot from its deterministic playbook to the OpenAI Responses API, falling back to the playbook on any failure. Without it, everything works; the pilot is just scripted. |
| `GROQ_API_KEY` | no | Same role as `OPENAI_API_KEY`, on Groq: the pilot runs `openai/gpt-oss-20b` (override with `PILOT_GROQ_MODEL`) with the same tool surface and the same playbook fallback. Used only when no OpenAI key/budget is available. It is an agent engine, never the verifier — checking stays deterministic. |
| `PILOT_DAILY_GROQ_RUNS` | no | Daily cap on Groq-backed pilot runs (default 300), mirroring `PILOT_DAILY_OPENAI_RUNS`. |

No other secrets exist. The approval nonce is minted per browser session at runtime and is never configured or deployed.

## Pre-flight (do this before you share the link)

1. **`pnpm test`, `pnpm typecheck`, `pnpm build`** — all three green, locally, on the commit you deploy.
2. Open `https://your-host/` in an ordinary browser. The chat in the homepage hero runs the demo end to end: send the pre-filled ask ("Move my stay to Friday for two nights, under $300.") → staged change at **$294, Room 418** → approve → the caught mismatch (**$319** charged). Asking again then stages the clean recovery (**Room 401, $247**), and approving that lands a green, fully-verified receipt. **Reset demo** (under the chat input) restores the canonical world at any time — use it before every rehearsal and before recording.
3. Open `https://your-host/agent-check` in the same browser. Note the verdict — in an ordinary browser it will usually say *Fallback mode* (no native WebMCP), which is expected and fine.
4. Open the same `/agent-check` URL in **ChatGPT's in-app browser**. It should say **“Ready — native WebMCP is live”**, list the two preflight tools, and pass all three checks. Ask the agent: *“What tools does this page give you? Call check_proof_connection.”* The call must appear under **Recent calls** labelled `external · WebMCP`.
5. Repeat the full flow (`/workspace`, the $300/Friday task) in ChatGPT's browser, with the workspace's Inspect panel open: the tool list changes as the task advances, every agent call is labelled `external`, and approving stays a button only you can press.

If step 4 shows anything other than native mode inside ChatGPT, do not hand judges the link — the deployment is fine but the browser path isn't, and that is the one part of the demo that must be real.

## What each URL is for

| URL | Purpose |
| --- | --- |
| `/` | The product story, with a live one-click demo (built-in fallback agent). |
| `/workspace` | Start a task in your own words. |
| `/workspace/{taskId}` | The task screen: four layers, approval card, mismatch + recovery. |
| `/agent-check` | Judge preflight: pass/fail on the native WebMCP surface, the ChatGPT test flow, the withheld list, and the provenance-labelled call log. |
