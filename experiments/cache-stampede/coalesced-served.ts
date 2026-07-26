/**
 * Cache-aside server with request coalescing.
 *
 * Same endpoint and same cache as naive-server.ts, but with one addition:
 * while a database lookup for a given key is already in flight, any other
 * request for that same key waits on the SAME promise instead of starting
 * its own lookup. The first request to miss "owns" the fetch; everyone
 * else behind it gets the result once it resolves.
 *
 * Run (from experiments/): npm run cache-stampede:coalesced
 */

import express from "express";
import { slowDatabaseLookup, dbCallCount, resetDbCallCount } from "./db";

const app = express();

const TTL_MS = 1000;
const cache = new Map<string, { value: string; expiresAt: number }>();

// Tracks in-flight database lookups per key, so concurrent misses can
// share one promise instead of each triggering their own database call.
const inFlight = new Map<string, Promise<string>>();

async function getValue(key: string): Promise<{ value: string; source: string }> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { value: cached.value, source: "cache" };
  }

  const existingFetch = inFlight.get(key);
  if (existingFetch) {
    // Someone else already noticed the miss and is fetching — wait on
    // their result instead of starting a second, third, fourth lookup.
    const value = await existingFetch;
    return { value, source: "coalesced" };
  }

  const fetchPromise = slowDatabaseLookup(key).then((value) => {
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    inFlight.delete(key);
    return value;
  });

  inFlight.set(key, fetchPromise);
  const value = await fetchPromise;
  return { value, source: "database" };
}

app.get("/item/:key", async (req, res) => {
  const result = await getValue(req.params.key);
  res.json(result);
});

app.post("/reset", (_req, res) => {
  cache.clear();
  inFlight.clear();
  resetDbCallCount();
  res.json({ ok: true });
});

app.post("/reset-count", (_req, res) => {
  resetDbCallCount();
  res.json({ ok: true });
});

app.get("/stats", (_req, res) => {
  res.json({ dbCallCount });
});

const PORT = 8001;
app.listen(PORT, () => {
  console.log(`Coalesced cache-aside server running on http://localhost:${PORT}`);
});
