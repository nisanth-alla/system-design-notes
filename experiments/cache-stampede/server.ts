/**
 * The real logic behind both cache-stampede terminal experiments — naive
 * cache-aside and cache-aside with request coalescing — merged into one
 * server with a runtime-switchable mode. This exists so Live mode in the
 * visualizations app can flip between "naive" and "coalesced" behavior
 * against one running server, instead of needing to stop one process and
 * start another to compare them.
 *
 * start.ts is a thin launcher around this file — `npm run cache-stampede:naive`
 * / `:coalesced` both run it with a different mode argument, which just
 * sets this server's initial mode.
 */

import cors from "cors";
import express from "express";
import { slowDatabaseLookup, dbCallCount, resetDbCallCount } from "./db";
import { createBroadcaster } from "../shared/broadcaster";

export type CacheStampedeServerMode = "naive" | "coalesced";

export function start(initialMode: CacheStampedeServerMode): void {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const TTL_MS = 1000;
  const cache = new Map<string, { value: string; expiresAt: number }>();

  // Only used in coalesced mode — tracks in-flight database lookups per
  // key, so concurrent misses can share one promise instead of each
  // triggering their own database call.
  const inFlight = new Map<string, { promise: Promise<string>; ownerId: number }>();

  let mode: CacheStampedeServerMode = initialMode;
  let broadcast: (event: object) => void = () => {};
  let requestCounter = 0;

  async function getValueNaive(
    key: string,
    requestId: number
  ): Promise<{ value: string; source: string }> {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      broadcast({ type: "cache-hit", requestId });
      return { value: cached.value, source: "cache" };
    }

    // Cache miss (or expired) — every concurrent request here independently
    // decides "I have to go to the database," with nothing to stop them
    // from all doing it at the same time.
    broadcast({ type: "cache-miss", requestId });
    broadcast({ type: "db-call-started", requestId });
    const value = await slowDatabaseLookup(key);
    broadcast({ type: "db-call-resolved", requestId });
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return { value, source: "database" };
  }

  async function getValueCoalesced(
    key: string,
    requestId: number
  ): Promise<{ value: string; source: string }> {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      broadcast({ type: "cache-hit", requestId });
      return { value: cached.value, source: "cache" };
    }

    const existing = inFlight.get(key);
    if (existing) {
      // Someone else already noticed the miss and is fetching — wait on
      // their result instead of starting a second, third, fourth lookup.
      broadcast({ type: "coalesced", requestId, waitingOn: existing.ownerId });
      const value = await existing.promise;
      broadcast({ type: "db-call-resolved", requestId });
      return { value, source: "coalesced" };
    }

    broadcast({ type: "cache-miss", requestId });
    broadcast({ type: "db-call-started", requestId });
    const fetchPromise = slowDatabaseLookup(key).then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
      inFlight.delete(key);
      return value;
    });

    inFlight.set(key, { promise: fetchPromise, ownerId: requestId });
    const value = await fetchPromise;
    broadcast({ type: "db-call-resolved", requestId });
    return { value, source: "database" };
  }

  app.get("/item/:key", async (req, res) => {
    const requestId = requestCounter++;
    broadcast({ type: "request-sent", requestId });

    const result =
      mode === "naive"
        ? await getValueNaive(req.params.key, requestId)
        : await getValueCoalesced(req.params.key, requestId);

    // Without this, browsers can serve a 304/cached response to some of the
    // 20 concurrent requests the visualization fires, or silently coalesce
    // identical concurrent GETs at the network layer, before this server's
    // own cache-aside logic ever runs — which quietly turns the demo of a
    // stampede into a demo of the browser's own request deduping instead.
    res.set("Cache-Control", "no-store");
    res.json(result);
  });

  app.post("/mode", (req, res) => {
    const nextMode = req.body?.mode;
    if (nextMode !== "naive" && nextMode !== "coalesced") {
      res.status(400).json({ error: "mode must be 'naive' or 'coalesced'" });
      return;
    }
    mode = nextMode;
    inFlight.clear();
    broadcast({ type: "mode-changed", mode });
    console.log(`Mode switched to: ${mode}`);
    res.json({ ok: true, mode });
  });

  app.get("/mode", (_req, res) => {
    res.json({ mode });
  });

  app.post("/reset", (_req, res) => {
    cache.clear();
    inFlight.clear();
    resetDbCallCount();
    requestCounter = 0;
    res.json({ ok: true });
  });

  app.post("/reset-count", (_req, res) => {
    resetDbCallCount();
    requestCounter = 0;
    res.json({ ok: true });
  });

  app.get("/stats", (_req, res) => {
    res.json({ dbCallCount, mode });
  });

  const PORT = 8001;
  const server = app.listen(PORT, () => {
    console.log(`Cache-stampede server running on http://localhost:${PORT} (mode: ${mode})`);
    console.log(`Broadcasting live events over the same port for the visualization's Live mode.`);
    console.log(`POST /mode with { "mode": "naive" | "coalesced" } to switch without restarting.`);
  });

  broadcast = createBroadcaster(server).broadcast;
}
