/**
 * Naive cache-aside server — vulnerable to a stampede.
 *
 * Standard cache-aside: check the cache, fall back to the (slow) database
 * on a miss, populate the cache with the result. This works fine under
 * normal traffic. It falls over when a hot key expires and many requests
 * arrive concurrently before any of them has finished repopulating it —
 * every one of those requests sees a miss and calls the database itself.
 *
 * Run (from experiments/): npm run cache-stampede:naive
 */

import express from "express";
import { slowDatabaseLookup, dbCallCount, resetDbCallCount } from "./db";

const app = express();

const TTL_MS = 1000;
const cache = new Map<string, { value: string; expiresAt: number }>();

app.get("/item/:key", async (req, res) => {
  const { key } = req.params;
  const cached = cache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    res.json({ value: cached.value, source: "cache" });
    return;
  }

  // Cache miss (or expired) — every concurrent request here independently
  // decides "I have to go to the database," with nothing to stop them
  // from all doing it at the same time.
  const value = await slowDatabaseLookup(key);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  res.json({ value, source: "database" });
});

app.post("/reset", (_req, res) => {
  cache.clear();
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
  console.log(`Naive cache-aside server running on http://localhost:${PORT}`);
});
