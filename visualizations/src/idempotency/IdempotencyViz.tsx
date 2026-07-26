import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHARGE_AMOUNT,
  IDEMPOTENCY_KEY,
  IdempotencyEvent,
  RETRY_COUNT,
  runIdempotencyRound,
} from "./simulation";

interface LogRow {
  attempt: number;
  outcome: "charged" | "duplicate";
}

type Source = "simulated" | "live";
type ConnectionState = "disconnected" | "connecting" | "connected" | "failed";

const LIVE_PORT = 8000;

export default function IdempotencyViz() {
  const [source, setSource] = useState<Source>("simulated");
  const [useKey, setUseKey] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const [totalCharges, setTotalCharges] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  const [liveUrl, setLiveUrl] = useState(`ws://localhost:${LIVE_PORT}`);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [modeSwitching, setModeSwitching] = useState(false);
  const [modeSwitchError, setModeSwitchError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const liveAttemptRef = useRef(0);

  const applyEvent = useCallback((event: IdempotencyEvent) => {
    if (event.type === "charged") {
      setLog((prev) => [...prev, { attempt: event.attempt, outcome: "charged" }]);
      setTotalCharges(event.totalCharges);
    } else if (event.type === "duplicate-detected") {
      setLog((prev) => [...prev, { attempt: event.attempt, outcome: "duplicate" }]);
      setTotalCharges(event.totalCharges);
    }
  }, []);

  const fireSimulatedRetries = useCallback(async () => {
    setRunning(true);
    setLog([]);
    setTotalCharges(null);
    await runIdempotencyRound(useKey, applyEvent);
    setRunning(false);
  }, [useKey, applyEvent]);

  const connectLive = useCallback(async () => {
    socketRef.current?.close();
    setConnectionState("connecting");

    try {
      const httpUrl = liveUrl.replace(/^ws/, "http");
      const res = await fetch(`${httpUrl}/mode`);
      if (res.ok) {
        const { requireKey } = (await res.json()) as { requireKey: boolean };
        setUseKey(requireKey);
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
    // "disconnected" for a connection that never actually opened.
    socket.onclose = () => {
      if (!hadError) setConnectionState("disconnected");
    };
    socket.onmessage = (msg) => {
      const raw = JSON.parse(msg.data) as
        | { type: "connected" }
        | { type: "mode-changed"; requireKey: boolean }
        | { type: "charged"; totalCharges: number }
        | { type: "duplicate-detected"; totalCharges: number };

      if (raw.type === "connected") return;
      if (raw.type === "mode-changed") {
        setUseKey(raw.requireKey);
        return;
      }

      // The server knows what it charged, not which retry attempt this was —
      // only the client issuing the retries knows that, so we attach it here
      // before handing the event to the same applyEvent used by Simulated mode.
      liveAttemptRef.current += 1;
      applyEvent({ ...raw, attempt: liveAttemptRef.current } as IdempotencyEvent);
    };

    socketRef.current = socket;
  }, [liveUrl, applyEvent]);

  useEffect(() => {
    return () => socketRef.current?.close();
  }, []);

  const fireLiveRetries = useCallback(async () => {
    if (connectionState !== "connected") return;

    setRunning(true);
    setLog([]);
    setTotalCharges(null);
    liveAttemptRef.current = 0;

    const httpUrl = liveUrl.replace(/^ws/, "http");

    try {
      await fetch(`${httpUrl}/reset`, { method: "POST" }).catch(() => {});

      for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (useKey) headers["Idempotency-Key"] = IDEMPOTENCY_KEY;

        await fetch(`${httpUrl}/charge`, {
          method: "POST",
          headers,
          body: JSON.stringify({ customerId: "customer_1", amount: CHARGE_AMOUNT }),
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (err) {
      // A dropped connection mid-round must not leave the UI stuck on
      // "Retrying…" forever.
      setModeSwitchError(
        err instanceof Error ? `Live round failed: ${err.message}` : "Live round failed"
      );
    } finally {
      setRunning(false);
    }
  }, [connectionState, liveUrl, useKey]);

  const fireRetries = source === "simulated" ? fireSimulatedRetries : fireLiveRetries;

  const changeUseKey = useCallback(
    async (nextUseKey: boolean) => {
      if (source === "live" && connectionState === "connected") {
        setModeSwitching(true);
        setModeSwitchError(null);
        try {
          const httpUrl = liveUrl.replace(/^ws/, "http");
          const res = await fetch(`${httpUrl}/mode`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requireKey: nextUseKey }),
          });
          if (!res.ok) {
            throw new Error(
              "Server rejected the mode switch — is it running an older version without /mode?"
            );
          }
          setUseKey(nextUseKey);
        } catch (err) {
          setModeSwitchError(err instanceof Error ? err.message : "Mode switch failed");
        } finally {
          setModeSwitching(false);
        }
      } else {
        setUseKey(nextUseKey);
      }
    },
    [source, connectionState, liveUrl]
  );

  return (
    <section className="viz">
      <h2>Idempotent Retries</h2>
      <p className="viz-caption">
        A client charges a customer's card, but the response gets lost — so it retries
        the same purchase {RETRY_COUNT} times, the way a real HTTP client would after a
        timeout. <strong>Without a key</strong>, the server has no memory and charges
        every attempt. <strong>With a key</strong>, the server recognizes the retries as
        the same purchase and returns the original result instead of charging again.
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
            Live mode connects to the real server in <code>experiments/idempotency</code> and
            charges a real (fake) card. Start it locally first:{" "}
            <code>cd experiments && npm run idempotency:naive</code> (or{" "}
            <code>idempotency:idempotent</code>), then connect below.
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
              {connectionState === "failed" && "connection failed — is the server running?"}
            </span>
          </div>
        </>
      )}

      <div className="viz-controls">
        <label>
          <input
            type="radio"
            name="idempotency-mode"
            checked={!useKey}
            onChange={() => changeUseKey(false)}
            disabled={running || modeSwitching}
          />
          Without idempotency key
        </label>
        <label>
          <input
            type="radio"
            name="idempotency-mode"
            checked={useKey}
            onChange={() => changeUseKey(true)}
            disabled={running || modeSwitching}
          />
          With idempotency key
        </label>
        <button
          onClick={fireRetries}
          disabled={running || modeSwitching || (source === "live" && connectionState !== "connected")}
        >
          {running ? "Retrying…" : `${source === "simulated" ? "Simulate" : "Send"} ${RETRY_COUNT} retries`}
        </button>
      </div>

      {source === "live" && modeSwitching && (
        <p className="viz-live-hint">
          Switching the server to {useKey ? "require" : "not require"} the idempotency key…
        </p>
      )}
      {source === "live" && modeSwitchError && (
        <p className="viz-live-hint" style={{ color: "var(--bad)" }}>{modeSwitchError}</p>
      )}

      <div className="viz-stage viz-stage-idempotency">
        <div className="viz-box viz-box-client">Client</div>
        <div className="viz-arrow">→</div>
        <div className="viz-box viz-box-server">
          Server
          {useKey && (
            <div className="viz-box-sub">
              key: <code>{IDEMPOTENCY_KEY.slice(0, 14)}…</code>
            </div>
          )}
        </div>
      </div>

      <table className="viz-log">
        <thead>
          <tr>
            <th>Attempt</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {log.map((row) => (
            <tr key={row.attempt} className={row.outcome === "duplicate" ? "viz-row-good" : "viz-row-neutral"}>
              <td>#{row.attempt}</td>
              <td>
                {row.outcome === "charged"
                  ? `charged $${CHARGE_AMOUNT}`
                  : "duplicate detected — returned original result, not charged again"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalCharges !== null && (
        <p className={`viz-result ${totalCharges === 1 ? "viz-result-good" : "viz-result-bad"}`}>
          Total charges for this customer: <strong>{totalCharges}</strong>
          {totalCharges === 1
            ? " — charged exactly once, no matter how many times the client retried."
            : ` — charged ${totalCharges} times for what should have been one purchase.`}
          {source === "live" && " (from the real server, not simulated)"}
        </p>
      )}
    </section>
  );
}
