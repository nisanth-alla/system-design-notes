# Experiment: Idempotency Keys

A small runnable example that reproduces the exact bug idempotency keys are meant to prevent, then fixes it. Companion to [`notes/retries-and-idempotency.md`](../../notes/retries-and-idempotency.md) — read that first if you want the concepts before the code.

## Problem

A client calls `POST /charge` to charge a customer's card. The request succeeds on the server, but the response gets lost on the way back (dropped connection, timeout, whatever). The client sees what looks like a failed request and retries. Without any protection, the server processes the charge twice — the customer gets billed twice for one purchase.

This is not a rare edge case — it's the default outcome of "network calls can fail in ambiguous ways" plus "clients retry on failure," which describes almost every real system.

## Approach

Two small Express servers, same `/charge` endpoint, one difference:

- `naive-server.ts` — processes every request it receives. No memory of past requests.
- `idempotent-server.ts` — requires an `Idempotency-Key` header on every request. Before processing, checks whether it's seen that key before. If yes, returns the stored result instead of charging again. If no, processes the charge and stores the result under that key.

`client.ts` simulates the failure: it sends a charge request, then — regardless of whether it got a response — retries the same logical request 3 times, the way a real retrying HTTP client would after a timeout.

## How to run

Run these from the `experiments/` folder (one shared `package.json` covers all experiments):

```bash
cd experiments
npm install

# Terminal 1 — pick one server to test against
npm run idempotency:naive
# or
npm run idempotency:idempotent

# Terminal 2
npm run idempotency:client
```

The client prints the server's response for each attempt, including its running charge counter, so you can see exactly what happened.

## Expected behavior

**Against `naive-server.ts`:**
```
Attempt 1: { status: 'charged', amount: 50, totalChargesForCustomer: 1 }
Attempt 2: { status: 'charged', amount: 50, totalChargesForCustomer: 2 }
Attempt 3: { status: 'charged', amount: 50, totalChargesForCustomer: 3 }
```
The customer gets charged 3 times for what should have been one purchase.

**Against `idempotent-server.ts`:**
```
Attempt 1: { status: 'charged', amount: 50, totalChargesForCustomer: 1, duplicate: false }
Attempt 2: { status: 'charged', amount: 50, totalChargesForCustomer: 1, duplicate: true }
Attempt 3: { status: 'charged', amount: 50, totalChargesForCustomer: 1, duplicate: true }
```
Same client, same retries — the customer is charged exactly once, and the duplicates are clearly labeled as such.

To see the naive behavior with the "safe" client (i.e., confirm the fix is on the server, not the client), run `ADD_IDEMPOTENCY_KEY=false npm run idempotency:client` against `idempotent-server.ts` — it will get rejected with a 400, since the key is required.

## Edge cases

Worth poking at once the basic version works, because these are where real idempotency implementations tend to have bugs:

- **Concurrent retries racing each other.** Fire two requests with the same key at literally the same time, before either has finished processing. The check-then-set pattern in `idempotent-server.ts` (`if (existing) {...}` then `seenRequests.set(...)`) has a race condition here — both requests can pass the check before either writes the result. A production fix needs an atomic "claim this key" step (a unique constraint at the database level, or a lock) before doing the actual work.
- **Same key, different payload.** The server currently rejects this with a 409 — try commenting that check out in `idempotent-server.ts` and rerun the client with a different `amount` on attempt 2 to see why silently returning the cached result would be the wrong call.
- **Key expiry.** The in-memory `Map` here never expires keys, which is fine for a demo and wrong for production (see the note in `retries-and-idempotency.md` about giving keys a TTL). Try adding one and observe what happens to a "retry" that arrives after the key has expired — it's treated as a brand new request, which is the correct and unavoidable tradeoff of any expiry window.
- **Partial failure mid-processing.** What if the process crashed after incrementing `chargeCount` but before `seenRequests.set()` runs? The retry would see no record and charge again. This is the hardest edge case here and the reason production systems tie the idempotency record write and the side effect into the same transaction wherever possible.

## Lessons learned

- The bug isn't really about retries — it's about the server having no memory. Retries are just the trigger that exposes it.
- Idempotency keys move the responsibility for correctness from "hope the network behaves" to "the server has a durable record of what it's already done," which is the only place that responsibility can actually live.
- The naive fix people reach for first — "just make the client smarter about not retrying" — doesn't work, because the client fundamentally cannot distinguish "my request never arrived" from "my request succeeded and the response got lost." The fix has to live on the server.
- Idempotency is easy to get *mostly* right and easy to get subtly wrong at the edges (races, partial failures) — which is exactly why it's worth actually running this instead of just reading about it.
