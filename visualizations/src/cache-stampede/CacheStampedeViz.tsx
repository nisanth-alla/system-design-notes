import { useCallback, useEffect, useRef, useState } from "react";
import {
  CacheStampedeEvent,
  CacheStampedeMode,
  DB_LATENCY_MS,
  REQUEST_COUNT,
  runCacheStampedeRound,
} from "./simulation";

type DotStatus = "in-flight" | "cache-hit" | "db-call" | "coalesced" | "resolved";
type Source = "simulated" | "live";
type ConnectionState = "disconnected" | "connecting" | "connected" | "failed";

interface Dot {
  id: number;
  status: DotStatus;
}

function initialDots(): Dot[] {
  return Array.from({ length: REQUEST_COUNT }, (_, id) => ({
    id,
    status: "in-flight" as DotStatus,
  }));
}

const LIVE_PORT = 8001;

export default function CacheStampedeViz() {
  const [source, setSource] = useState<Source>("simulated");
  const [mode, setMode] = useState<CacheStampedeMode>("naive");
  const [dots, setDots] = useState<Dot[]>([]);
  const [dbCallCount, setDbCallCount] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const roundToken = useRef(0);

  const [liveUrl, setLiveUrl] = useState(`ws://localhost:${LIVE_PORT}`);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [modeSwitching, setModeSwitching] = useState(false);
  const [modeSwitchError, setModeSwitchError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const liveDbCallsRef = useRef(0);
  const liveCompletedIdsRef = useRef<Set<number>>(new Set());
  const liveRoundArmedRef = useRef(false);

  // The exact same event handler drives both the simulated round and the
  // live WebSocket feed — the event shapes are identical, so nothing about
  // the animation code needs to know or care which source produced them.
  const applyEvent = useCallback((event: CacheStampedeEvent) => {
    setDots((prev) => {
      switch (event.type) {
        case "cache-miss":
        case "db-call-started":
          return prev.map((d) => (d.id === event.requestId ? { ...d, status: "db-call" } : d));
        case "coalesced":
          return prev.map((d) => (d.id === event.requestId ? { ...d, status: "coalesced" } : d));
        case "db-call-resolved":
          return prev.map((d) => (d.id === event.requestId ? { ...d, status: "resolved" } : d));
        case "cache-hit":
          return prev.map((d) => (d.id === event.requestId ? { ...d, status: "cache-hit" } : d));
        default:
          return prev;
      }
    });

    if (event.type === "round-complete") {
      setDbCallCount(event.dbCallCount);
      setRunning(false);
    }
  }, []);

  const fireSimulatedRequests = useCallback(async () => {
    const myToken = ++roundToken.current;
    setRunning(true);
    setDbCallCount(null);
    setDots(initialDots());

    await runCacheStampedeRound(mode, (event) => {
      if (roundToken.current === myToken) applyEvent(event);
    });
  }, [mode, applyEvent]);

  const connectLive = useCallback(async () => {
    socketRef.current?.close();
    setConnectionState("connecting");

    try {
      const httpUrl = liveUrl.replace(/^ws/, "http");
      const res = await fetch(`${httpUrl}/mode`);
      if (res.ok) {
        const { mode: serverMode } = (await res.json()) as { mode: CacheStampedeMode };
        setMode(serverMode);
      }
    } catch {
      // If this fails the WebSocket connection below will also fail and
      // surface the same "connection failed" state — no need to duplicate it.
    }

    const socket = new WebSocket(liveUrl);
    let hadError = false;

    socket.onopen = () => setConnectionState("connected");
    socket.onerror = () => {
      hadError = true;
      setConnectionState("failed");
    };
    // A failed connection attempt fires onerror then onclose back-to-back —
    // don't let onclose downgrade "failed" to the more ambiguous
    // "disconnected" for a connection that never actually opened. Also, if
    // the connection drops mid-round (after the burst was fired but before
    // all 20 db-call-resolved events arrived), there's no other path that
    // clears `running` — so do it here too, instead of leaving the UI
    // stuck on "Running…" until a page reload.
    socket.onclose = () => {
      if (!hadError) setConnectionState("disconnected");
      if (liveRoundArmedRef.current) {
        liveRoundArmedRef.current = false;
        setRunning(false);
      }
    };
    socket.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as
        | CacheStampedeEvent
        | { type: "connected" }
        | { type: "mode-changed"; mode: CacheStampedeMode };

      if (event.type === "connected") return;
      if (event.type === "mode-changed") {
        setMode(event.mode);
        return;
      }
      // Ignore events from the warm-up request (and anything else that
      // happens before we've armed a round) — otherwise its own
      // db-call-started/resolved pair animates a dot before the real
      // burst's dots even exist yet.
      if (!liveRoundArmedRef.current) return;

      applyEvent(event);
      if (event.type === "db-call-started") liveDbCallsRef.current += 1;

      // A request is "done" whether it resolved via a real database call,
      // a coalesced wait (which also ends in db-call-resolved — see
      // getValueCoalesced in server.ts), or a cache-hit. Counting only
      // db-call-resolved under-counts the round the moment any request
      // lands on an already-warm cache — which happens routinely once the
      // browser's per-origin connection limit (6, in most browsers) staggers
      // when these "concurrent" requests actually reach the server, letting
      // an early responder repopulate the cache before later ones arrive.
      const isTerminal = event.type === "db-call-resolved" || event.type === "cache-hit";
      if (isTerminal && "requestId" in event) {
        liveCompletedIdsRef.current.add(event.requestId);
        if (liveCompletedIdsRef.current.size === REQUEST_COUNT) {
          setDbCallCount(liveDbCallsRef.current);
          setRunning(false);
          liveRoundArmedRef.current = false;
        }
      }
    };

    socketRef.current = socket;
  }, [liveUrl, applyEvent]);

  useEffect(() => {
    return () => socketRef.current?.close();
  }, []);

  const fireLiveRequests = useCallback(async () => {
    if (connectionState !== "connected") return;

    liveRoundArmedRef.current = false;
    setRunning(true);
    setDbCallCount(null);

    const httpUrl = liveUrl.replace(/^ws/, "http");
    const key = "hot-product-42";

    try {
      await fetch(`${httpUrl}/reset`, { method: "POST" });
      // Warm the cache once, then let it expire, then fire the real burst —
      // same choreography as experiments/cache-stampede/load.ts. The warm-up
      // call also broadcasts its own db-call-started/resolved events, which
      // are ignored above until the round is armed below, so they can't leak
      // into the burst's dots or counts.
      await fetch(`${httpUrl}/item/${key}`, { cache: "no-store" });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await fetch(`${httpUrl}/reset-count`, { method: "POST" }).catch(() => {});
      // Small buffer so the warm-up call's own WS events (which can arrive
      // slightly after its HTTP response resolves) are done landing before
      // we arm the round below.
      await new Promise((resolve) => setTimeout(resolve, 100));

      setDots(initialDots());
      liveDbCallsRef.current = 0;
      liveCompletedIdsRef.current = new Set();
      liveRoundArmedRef.current = true;

      // cache: "no-store" matters here beyond just bypassing HTTP caching —
      // without it, browsers can silently coalesce identical concurrent GET
      // requests to the same URL at the network layer, so only a couple of
      // these 20 fetches ever actually reach the server. That collapses the
      // stampede before the server's own cache-aside logic sees it, and
      // leaves this round waiting forever on db-call-resolved events for
      // requests that were never really sent.
      await Promise.all(
        Array.from({ length: REQUEST_COUNT }, () =>
          fetch(`${httpUrl}/item/${key}`, { cache: "no-store" })
        )
      );
    } catch (err) {
      // A dropped connection or a request that fails mid-sequence must not
      // leave the UI stuck on "Running…" forever — there's no other path
      // that clears `running` for a live round (that normally happens once
      // all 20 db-call-resolved events arrive over the WebSocket).
      liveRoundArmedRef.current = false;
      setRunning(false);
      setModeSwitchError(
        err instanceof Error ? `Live round failed: ${err.message}` : "Live round failed"
      );
    }
  }, [connectionState, liveUrl]);

  const fireRequests = source === "simulated" ? fireSimulatedRequests : fireLiveRequests;

  const changeMode = useCallback(
    async (nextMode: CacheStampedeMode) => {
      if (source === "live" && connectionState === "connected") {
        setModeSwitching(true);
        setModeSwitchError(null);
        try {
          const httpUrl = liveUrl.replace(/^ws/, "http");
          const res = await fetch(`${httpUrl}/mode`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: nextMode }),
          });
          if (!res.ok) {
            throw new Error(
              "Server rejected the mode switch — is it running an older version without /mode?"
            );
          }
          setMode(nextMode);
        } catch (err) {
          setModeSwitchError(err instanceof Error ? err.message : "Mode switch failed");
        } finally {
          setModeSwitching(false);
        }
      } else {
        setMode(nextMode);
      }
    },
    [source, connectionState, liveUrl]
  );

  return (
    <section className="viz">
      <h2>Cache Stampede</h2>
      <p className="viz-caption">
        A cache entry just expired. {REQUEST_COUNT} concurrent requests arrive for that
        same key at once. In <strong>naive</strong> mode, every one of them misses the
        cache independently and calls the database itself. In{" "}
        <strong>coalesced</strong> mode, only the first request that notices the miss
        calls the database — everyone else waits on that same in-flight call instead of
        starting their own.
      </p>

      <div className="viz-mode-tabs">
        <button
          className={`viz-mode-tab ${source === "simulated" ? "viz-mode-tab-active" : ""}`}
          onClick={() => setSource("simulated")}
        >
          Simulated
        </button>
        <button
          className={`viz-mode-tab ${source === "live" ? "viz-mode-tab-active" : ""}`}
          onClick={() => setSource("live")}
        >
          Live
        </button>
      </div>

      {source === "live" && (
        <>
          <p className="viz-live-hint">
            Live mode connects to the real server in <code>experiments/cache-stampede</code> and
            animates its actual events. Start it locally first:{" "}
            <code>cd experiments && npm run cache-stampede:naive</code> (or{" "}
            <code>:coalesced</code>), then connect below.
          </p>
          <div className="viz-live-panel">
            <input
              value={liveUrl}
              onChange={(e) => setLiveUrl(e.target.value)}
              disabled={connectionState === "connected"}
            />
            <button onClick={connectLive} disabled={connectionState === "connected"}>
              {connectionState === "connecting" ? "Connecting…" : "Connect"}
            </button>
            <span
              className={`viz-live-status ${
                connectionState === "connected"
                  ? "viz-live-status-connected"
                  : "viz-live-status-disconnected"
              }`}
            >
              {connectionState === "connected" && "connected"}
              {connectionState === "connecting" && "connecting…"}
              {connectionState === "disconnected" && "not connected"}
              {connectionState === "failed" &&
                "connection failed — is the server running?"}
            </span>
          </div>
        </>
      )}

      <div className="viz-controls">
        <label>
          <input
            type="radio"
            name="cache-mode"
            checked={mode === "naive"}
            onChange={() => changeMode("naive")}
            disabled={running || modeSwitching}
          />
          Naive
        </label>
        <label>
          <input
            type="radio"
            name="cache-mode"
            checked={mode === "coalesced"}
            onChange={() => changeMode("coalesced")}
            disabled={running || modeSwitching}
          />
          Coalesced
        </label>
        <button
          onClick={fireRequests}
          disabled={running || modeSwitching || (source === "live" && connectionState !== "connected")}
        >
          {running ? "Running…" : `Fire ${REQUEST_COUNT} concurrent requests`}
        </button>
      </div>

      {source === "live" && modeSwitching && (
        <p className="viz-live-hint">Switching the server to {mode} mode…</p>
      )}
      {source === "live" && modeSwitchError && (
        <p className="viz-live-hint" style={{ color: "var(--bad)" }}>{modeSwitchError}</p>
      )}

      <div className="viz-stage">
        <div className="viz-lane viz-lane-clients">
          {dots.map((dot) => (
            <span key={dot.id} className={`viz-dot viz-dot-${dot.status}`} title={`Request ${dot.id}`} />
          ))}
        </div>
        <div className="viz-arrow">→</div>
        <div className="viz-box viz-box-cache">Cache</div>
        <div className="viz-arrow">→</div>
        <div className={`viz-box viz-box-db ${running && mode === "naive" ? "viz-box-hot" : ""}`}>
          Database
          <div className="viz-box-sub">
            {source === "simulated" ? `${DB_LATENCY_MS}ms lookup (simulated)` : "real lookup"}
          </div>
        </div>
      </div>

      <div className="viz-legend">
        <span className="viz-legend-item"><span className="viz-dot viz-dot-in-flight" /> waiting to be sent</span>
        <span className="viz-legend-item"><span className="viz-dot viz-dot-db-call" /> calling the database</span>
        <span className="viz-legend-item"><span className="viz-dot viz-dot-coalesced" /> waiting on someone else's call</span>
        <span className="viz-legend-item"><span className="viz-dot viz-dot-resolved" /> done — hit the database</span>
        <span className="viz-legend-item"><span className="viz-dot viz-dot-cache-hit" /> done — served from cache, no database call</span>
      </div>

      {dbCallCount !== null && (
        <p className={`viz-result ${dbCallCount === 1 ? "viz-result-good" : "viz-result-bad"}`}>
          Database calls this round: <strong>{dbCallCount}</strong>
          {dbCallCount === 1
            ? " — only one request actually reached the database."
            : ` — ${dbCallCount} requests reached the database for what should have been one cache refill.`}
          {source === "live" && " (from the real server, not simulated)"}
        </p>
      )}

      {source === "live" && dbCallCount !== null && mode === "naive" && dbCallCount < REQUEST_COUNT && (
        <p className="viz-live-hint">
          Fewer than {REQUEST_COUNT} here is expected, not a bug: browsers cap concurrent
          connections to the same origin (6 in most browsers), so your {REQUEST_COUNT} requests
          didn't all leave at once — some arrived after an earlier one had already refilled the
          cache and got a real <code>cache-hit</code> instead of hitting the database. The terminal
          experiment (<code>npm run cache-stampede:load</code>) and Simulated mode aren't
          bottlenecked this way, which is why they show the full {REQUEST_COUNT}-call stampede.
        </p>
      )}
    </section>
  );
}
