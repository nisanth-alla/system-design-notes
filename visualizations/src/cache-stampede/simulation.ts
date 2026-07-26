/**
 * Pure simulation logic for the cache-stampede visualization — no DOM, no
 * React. Mirrors the real behavior in ../../experiments/cache-stampede
 * (naive vs. coalesced mode in experiments/cache-stampede/server.ts) but
 * runs in-browser with
 * shortened, UI-friendly timings instead of hitting a real Express server.
 *
 * The component subscribes to onEvent() to animate each state transition
 * as it happens, rather than just reading a final result.
 */

export const DB_LATENCY_MS = 1200;
export const REQUEST_COUNT = 20;

export type CacheStampedeMode = "naive" | "coalesced";

export type CacheStampedeEvent =
  | { type: "request-sent"; requestId: number }
  | { type: "cache-hit"; requestId: number }
  | { type: "cache-miss"; requestId: number }
  | { type: "db-call-started"; requestId: number }
  | { type: "coalesced"; requestId: number; waitingOn: number }
  | { type: "db-call-resolved"; requestId: number }
  | { type: "round-complete"; dbCallCount: number };

type Listener = (event: CacheStampedeEvent) => void;

function fakeDatabaseLookup(): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(`value-${Date.now()}`), DB_LATENCY_MS);
  });
}

export async function runCacheStampedeRound(
  mode: CacheStampedeMode,
  onEvent: Listener
): Promise<void> {
  let dbCallCount = 0;

  if (mode === "naive") {
    // Every request independently misses and independently calls the
    // "database" — nothing coordinates them, so they all pile up at once.
    const requests = Array.from({ length: REQUEST_COUNT }, (_, i) => i);

    await Promise.all(
      requests.map(async (requestId) => {
        onEvent({ type: "request-sent", requestId });
        onEvent({ type: "cache-miss", requestId });
        onEvent({ type: "db-call-started", requestId });
        dbCallCount += 1;
        await fakeDatabaseLookup();
        onEvent({ type: "db-call-resolved", requestId });
      })
    );
  } else {
    // Request 0 owns the fetch. Everyone else sees it's already in flight
    // and waits on the same promise instead of starting their own.
    let inFlight: Promise<string> | null = null;
    let ownerId: number | null = null;

    const requests = Array.from({ length: REQUEST_COUNT }, (_, i) => i);

    await Promise.all(
      requests.map(async (requestId) => {
        onEvent({ type: "request-sent", requestId });

        if (inFlight) {
          onEvent({ type: "coalesced", requestId, waitingOn: ownerId! });
          await inFlight;
          onEvent({ type: "db-call-resolved", requestId });
          return;
        }

        onEvent({ type: "cache-miss", requestId });
        onEvent({ type: "db-call-started", requestId });
        dbCallCount += 1;
        ownerId = requestId;
        inFlight = fakeDatabaseLookup();
        await inFlight;
        onEvent({ type: "db-call-resolved", requestId });
      })
    );
  }

  onEvent({ type: "round-complete", dbCallCount });
}
