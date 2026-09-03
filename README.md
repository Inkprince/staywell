# StayWell, with Proof

> **Book beautifully. Change confidently. Proof checks the result.**

StayWell is a premium hotel web app with live room availability, demand-aware prices, reservations, and a guest itinerary. Guests can use it normally: browse rooms, choose dates, book a stay, and manage a reservation.

Proof is the verified agent-assistance layer inside StayWell. It helps a guest make an important change without having to blindly trust an agent's "done." The agent can read live hotel information, compare rooms, quote a change, and prepare it. The guest approves. StayWell checks the final room, dates, and price before calling it complete.

## The demo

The main StayWell flow is real and connected:

1. Visit `/stays` to choose dates, compare five room collections, and see live prices.
2. Book a room and pay for it — the demo checkout offers demo cards, Apple Pay, or pay-at-the-hotel. No real money moves; the paid/unpaid state is real.
3. Open the reservation in `/reservations`.
4. Ask Proof for help — from the reservation page, from the **Ask Proof** button that follows you around the site, or straight from the live chat on the homepage.
5. Ask: _"Move my stay to Friday for two nights, under $300."_
6. The agent plans and stages a change. A person approves it.
7. StayWell applies the change and reads its state again.

On the canonical demo seed, the review quote is $294. Competing demand then lands and the real committed price becomes $319. Proof catches the mismatch instead of calling it complete — and this time there is a way forward that breaks nothing: another room at $247 that keeps Friday and both nights. Approve it and the receipt is green, every condition verified. A **Reset demo** control in the chat restores the canonical world at any time.

## WebMCP

The page exposes real, state-gated WebMCP tools through `document.modelContext`:

- Read a task, reservation, availability, constraints, history, and verification.
- Set or refine conditions, quote a change, and stage it for review.
- Find and stage recovery options after a mismatch.
- Verify a result only after a change has been committed.

An agent never receives a tool to approve, commit, accept an exception, or mark a task complete. Those powers are structurally absent. The guest approves, and the site performs the final deterministic check.

Open `/agent-check` in ChatGPT's in-app browser to test the native surface. It shows the platform's actual tool list, the withheld actions, and a tool-call log. The built-in assistant is explicitly a fallback for ordinary browsers; it is not presented as an external WebMCP agent.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3210`.

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm evals
```

## Deployment

This demo currently uses an in-memory store. Deploy it as one long-lived Node instance behind HTTPS for judging; do not use multi-instance autoscaling or a serverless deployment until a shared store is added. See [deployment guidance](docs/deployment.md).

## Project notes

- [Architecture](docs/architecture.md)
- [WebMCP contract](docs/webmcp.md)
- [Security model](docs/security.md)

Apache-2.0 licensed. See [LICENSE](LICENSE).
