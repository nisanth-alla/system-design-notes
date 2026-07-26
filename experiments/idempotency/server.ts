/**
 * The real logic behind both idempotency terminal experiments — naive
 * (no protection) and idempotent (key-based dedup) — merged into one
 * server with a runtime-switchable mode. This exists so Live mode in the
 * visualizations app can flip between "without key" and "with key"
 * enforcement against one running server, instead of needing to stop one
 * process and start another to compare them.
 *
 * start.ts is a thin launcher around this file — `npm run idempotency:naive`
 * / `:idempotent` both run it with a different mode argument, which just
 * sets this server's initial mode.
 */

import cors from "cors";
import express, { Request, Response } from "express";
import { createBroadcaster } from "../shared/broadcaster";

interface ChargeRequestBody {
  customerId: string;
  amount: number;
}

interface ChargeResult {
  status: "charged";
  customerId: string;
  amount: number;
  totalChargesForCustomer: number;
}

interface StoredRequest {
  response: ChargeResult;
  // Serialized request body, kept only for equality checks against a
  // retry's body — not a hash, no fixed size, don't call it one.
  payloadSnapshot: string;
}

export function start(initialRequireKey: boolean): void {
  const app = express();
  app.use(cors());
  app.use(express.json());

  let requireIdempotencyKey = initialRequireKey;
  let chargeCount = 0;
  let broadcast: (event: object) => void = () => {};

  // key -> what we did last time we saw this key. Only consulted when
  // requireIdempotencyKey is true. A real system would put this in a
  // database with a unique constraint on the key and a TTL — see the
  // "edge cases" section in README.md.
  const seenRequests = new Map<string, StoredRequest>();

  function serializePayload(payload: ChargeRequestBody): string {
    return JSON.stringify(payload);
  }

  app.post("/charge", (req: Request<{}, {}, ChargeRequestBody>, res: Response) => {
    if (!requireIdempotencyKey) {
      // No memory of past requests — every call is treated as brand new,
      // which is exactly the bug this experiment exists to demonstrate.
      chargeCount += 1;
      broadcast({ type: "charged", totalCharges: chargeCount });
      res.json({
        status: "charged",
        customerId: req.body.customerId,
        amount: req.body.amount,
        totalChargesForCustomer: chargeCount,
      });
      return;
    }

    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      res.status(400).json({ error: "Idempotency-Key header is required" });
      return;
    }

    const payloadSnapshot = serializePayload(req.body);
    const existing = seenRequests.get(idempotencyKey);

    if (existing) {
      if (existing.payloadSnapshot !== payloadSnapshot) {
        // Same key, different request body — this is a client bug.
        // Reject loudly instead of silently returning the wrong cached result.
        res.status(409).json({
          error: "Idempotency-Key reused with a different request payload",
        });
        return;
      }

      broadcast({ type: "duplicate-detected", totalCharges: chargeCount });
      res.json({ ...existing.response, duplicate: true });
      return;
    }

    // NOTE: this is the "partial failure mid-processing" edge case from
    // README.md — if the process crashed between the charge below and the
    // seenRequests.set() call, a retry would charge again. Production
    // systems close this gap by writing the idempotency record and the
    // side effect in the same transaction.
    chargeCount += 1;
    const response: ChargeResult = {
      status: "charged",
      customerId: req.body.customerId,
      amount: req.body.amount,
      totalChargesForCustomer: chargeCount,
    };

    seenRequests.set(idempotencyKey, { response, payloadSnapshot });
    broadcast({ type: "charged", totalCharges: chargeCount });

    res.json({ ...response, duplicate: false });
  });

  app.post("/mode", (req, res) => {
    const requireKey = req.body?.requireKey;
    if (typeof requireKey !== "boolean") {
      res.status(400).json({ error: "requireKey must be a boolean" });
      return;
    }
    requireIdempotencyKey = requireKey;
    broadcast({ type: "mode-changed", requireKey });
    console.log(`Mode switched to: ${requireKey ? "idempotent (key required)" : "naive (no protection)"}`);
    res.json({ ok: true, requireKey });
  });

  app.get("/mode", (_req, res) => {
    res.json({ requireKey: requireIdempotencyKey });
  });

  app.post("/reset", (_req, res) => {
    chargeCount = 0;
    seenRequests.clear();
    res.json({ ok: true });
  });

  const PORT = 8000;
  const server = app.listen(PORT, () => {
    console.log(
      `Idempotency server running on http://localhost:${PORT} (mode: ${
        requireIdempotencyKey ? "idempotent" : "naive"
      })`
    );
    console.log(`Broadcasting live events over the same port for the visualization's Live mode.`);
    console.log(`POST /mode with { "requireKey": true | false } to switch without restarting.`);
  });

  broadcast = createBroadcaster(server).broadcast;
}
