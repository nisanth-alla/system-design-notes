# Caching

## What it is

A cache is a copy of data placed somewhere faster to read from than the source of truth — usually because the source (a database, an external API, a slow computation) is too slow or too expensive to hit on every request.

The cache is never the source of truth. It's a bet: that the data you're storing won't change before you need to throw it away, and that reading the copy is cheap enough to be worth the risk of it being briefly wrong.

## When to use it

Reach for a cache when:

- The same data is read far more often than it's written (read-heavy, low-churn data — user profiles, product catalogs, config).
- The underlying computation or query is expensive relative to how often the result actually changes.
- You can tolerate the data being slightly stale — even by a few seconds.

Don't reach for a cache when:

- The data changes on almost every read anyway (cache hit rate will be near zero, and now you have two systems to keep in sync for no benefit).
- Correctness requirements mean stale-by-even-one-second is unacceptable (e.g., an account balance mid-transaction).
- You haven't actually measured that the thing you're caching is slow. Caching is a fix for a measured problem, not a default architectural layer.

## Cache-aside vs. write-through

These are the two patterns that cover most real systems.

**Cache-aside (lazy loading)**
The application checks the cache first. On a miss, it reads from the database, then writes the result into the cache for next time.

```
read(key):
  value = cache.get(key)
  if value is None:
    value = db.get(key)
    cache.set(key, value, ttl=...)
  return value
```

- Cache only holds what's actually been requested — no wasted space on cold data.
- First request after a miss (or after eviction) pays the full latency cost.
- Writes go to the database; the cache is either invalidated or left to expire via TTL. This is the part people get wrong — see Failure modes below.

**Write-through**
Every write goes through the cache, which immediately writes to the database (or the cache is updated in the same transaction as the DB write).

- Cache is always consistent with the DB right after a write — no stale-read window on the write path.
- Every write pays cache-write latency, even for data that might never be read again.
- Simpler mental model for consistency, at the cost of write throughput.

A rule of thumb: cache-aside is the default for read-heavy systems where writes are relatively rare. Write-through earns its cost when staleness right after a write is specifically what you're trying to avoid (e.g., a user edits their own profile and immediately reloads the page — you don't want them to see old data).

## Failure modes

**Stale cache after a write.** If you update the DB but forget to invalidate or update the cache, readers keep seeing old data until the TTL expires. This is the single most common caching bug in production systems. The fix is almost always "invalidate on write," not "make the TTL shorter" — a shorter TTL just narrows the window, it doesn't close it.

**Cache stampede (a.k.a. thundering herd).** A popular key expires, and a thousand concurrent requests all miss at once and all hit the database simultaneously — sometimes hard enough to take it down. Mitigations: request coalescing (only one request per key is allowed to go to the DB, others wait on it), staggered/jittered TTLs so hot keys don't all expire in the same instant, or serving stale data for a short grace period while a single background refresh happens. See [`experiments/cache-stampede`](../experiments/cache-stampede) for a runnable reproduction of this exact failure and the request-coalescing fix.

**Cache as a single point of failure.** If your application can't function when the cache is down (rather than just running slower), you've accidentally made the cache load-bearing instead of an optimization. Design so a cold or unavailable cache degrades performance, not correctness or availability.

**Unbounded cache growth.** Without eviction (LRU, LFU, or TTL-based), a cache just becomes a slow memory leak with extra steps.

## Real example

A product listings page that queries a database for "top 50 items in category X" is a great caching candidate — the query is relatively expensive (joins, sorting, filtering) and the result barely changes minute to minute. Cache-aside with a short TTL (say, 60 seconds) and jittered expiry cuts database load enormously with a staleness window most users will never notice.

Contrast that with a shopping cart total during checkout — that's exactly the kind of data where staleness causes real bugs (charging the wrong amount), so it either isn't cached or uses write-through with careful invalidation.

## 5-line summary

- A cache trades a small risk of staleness for a big win in latency and load.
- Cache-aside: read from cache, fall back to DB on miss, populate cache after. Best for read-heavy, write-light data.
- Write-through: writes go through the cache so it's never stale right after a write, at the cost of slower writes.
- The most common bug is forgetting to invalidate the cache on write — don't just rely on TTL.
- Watch for stampedes on hot keys and never let the cache become something your system can't function without.
