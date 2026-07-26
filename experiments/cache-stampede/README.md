# Experiment: Cache Stampede

A small runnable example that reproduces a cache stampede on a hot key, then fixes it with request coalescing. Companion to [`notes/caching.md`](../../notes/caching.md) — read that first if you want the concepts before the code.

## Problem

A cache-aside setup works great under normal load: check the cache, fall back to the database on a miss, populate the cache for next time. The failure shows up specifically when a **popular** key expires — many concurrent requests for that key arrive before any of them has finished repopulating the cache. Every one of those requests independently sees a miss and independently calls the database, all at roughly the same moment. For a hot key, that can mean dozens or hundreds of simultaneous hits on a backend that was supposed to see, at most, one.

This is the stampede (a.k.a. thundering herd): the cache didn't fail, it just has a blind spot the instant a hot entry expires.

## Approach

One Express server (`server.ts`) exposes `GET /item/:key`, backed by the same artificially slow "database" (`db.ts`, a 300ms delay standing in for an expensive query). It runs in one of two modes:

- **naive** — textbook cache-aside. On a miss, it just calls the database, no coordination with any other in-flight request for the same key.
- **coalesced** — same cache-aside logic, but tracks in-flight lookups per key. If a request misses while another request for that same key is already fetching, it waits on that existing fetch instead of starting a new one. Only the first miss for a key actually touches the database; everyone else behind it shares the result.

`start.ts naive` / `start.ts coalesced` (wired to `npm run cache-stampede:naive` / `:coalesced`) just pick which mode the server starts in. A running server's mode can also be changed live via `POST /mode` (body: `{ "mode": "naive" | "coalesced" }`) — that's what the [visualization's](../../visualizations) "Live" mode uses to let you flip between naive and coalesced against one running server instead of stopping one script and starting another.

`load.ts` warms the cache with one request, waits for the 1-second TTL to expire, then fires 20 concurrent requests for the same key — the exact condition that triggers a stampede — and reports how many of those requests actually reached the database.

The server also broadcasts its real events over a small WebSocket (via `../shared/broadcaster.ts`) — purely additive, it doesn't change any HTTP response or the console output above. Start it, open the visualization, switch to Live, and connect — no restart needed to compare naive vs. coalesced once connected.

## How to run

Run these from the `experiments/` folder (one shared `package.json` covers all experiments):

```bash
cd experiments
npm install

# Terminal 1 — pick one server to test against
npm run cache-stampede:naive
# or
npm run cache-stampede:coalesced

# Terminal 2
npm run cache-stampede:load
```

## Expected behavior

**In naive mode:**
```
Fired 20 concurrent requests for the same key.
Where each response came from: { database: 20 }

Database calls made during the burst: 20
20 requests reached the database for what should have been ONE cache refill.
```
Every single request in the burst missed the cache and hit the database — the TTL expiry turned one logical "refresh this key" into 20 real database calls happening at once.

**In coalesced mode:**
```
Fired 20 concurrent requests for the same key.
Where each response came from: { database: 1, coalesced: 19 }

Database calls made during the burst: 1
Only one request actually reached the database — the rest waited on it or hit the cache.
```
Same burst, same TTL, same "database" — but only the first request that noticed the miss actually fetched. The other 19 waited on that one in-flight lookup and got the same result once it resolved.

## Edge cases

Worth poking at once the basic version works, because these are the parts a real implementation has to get right:

- **A failed fetch shouldn't poison every waiter.** In coalesced mode, if `slowDatabaseLookup` throws, every request awaiting that shared promise gets the same rejection. That's usually correct (better than 20 requests independently failing against an already-struggling backend), but it means one bad fetch fails the whole waiting group — worth deciding if any of them should retry independently versus surface the error immediately.
- **Coalescing only helps within a single process.** If this server runs behind a load balancer with multiple instances, each instance has its own `inFlight` map — the stampede is reduced by a factor of however many requests land on the same instance, not eliminated across the fleet. A shared coalescing layer (e.g., a lock in Redis) is what closes that gap, at the cost of a network round trip to coordinate.
- **Jittered TTLs are a complementary fix, not a replacement.** Try setting each key's TTL to `TTL_MS + Math.random() * 500` in `server.ts` instead of a fixed value — it spreads out expirations for *different* keys so they don't all stampede at the same instant, but it does nothing for the case in this experiment, where it's the *same* key being hit by many concurrent requests.
- **Serving stale-while-revalidating.** A more forgiving variant: when a key expires, keep serving the old value to new requests while exactly one background request refreshes it, instead of making anyone wait on the fetch at all. Worth sketching out as a follow-up — it trades a little more staleness for zero added latency on the requests that would otherwise wait on the coalesced fetch.

## Lessons learned

- A stampede isn't a bug in the cache — it's a gap in the cache-aside *pattern* when nothing coordinates concurrent misses for the same key.
- The fix isn't "make the cache faster" or "make the database faster" — it's "make sure only one request does the work on behalf of everyone waiting on it." That's a coordination problem, not a performance problem.
- Request coalescing is cheap to add (a `Map` of in-flight promises) and removes the most common version of this failure entirely for single-instance deployments — it's worth being a default, not an optimization you reach for after an incident.
- This is exactly the kind of bug that's invisible in normal load testing (steady traffic never creates the "many requests miss at literally the same instant" condition) and only shows up when a genuinely popular key expires in production — which is precisely why it's worth reproducing on purpose here rather than trusting that it "probably won't happen."
