/**
 * Idempotent charge server.
 *
 * Same /charge endpoint as naive-server.ts, but every request must include
 * an `Idempotency-Key` header. The server keeps a record of every key it's
 * seen and what it returned, so a retried request gets the original result
 * back instead of triggering a second charge.
 *
 * Run (from experiments/): npm run idempotency:idempotent
 */

import express, { Request, Response } from "express";

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
  payloadHash: string;
}

const app = express();
app.use(express.json());

let chargeCount = 0;

// key -> what we did last time we saw this key.
// A real system would put this in a database with a unique constraint on
// the key and a TTL — see the "edge cases" section in README.md.
const seenRequests = new Map<string, StoredRequest>();

function hashPayload(payload: ChargeRequestBody): string {
  return JSON.stringify(payload);
}

app.post("/charge", (req: Request<{}, {}, ChargeRequestBody>, res: Response) => {
  const idempotencyKey = req.header("Idempotency-Key");
  if (!idempotencyKey) {
    res.status(400).json({ error: "Idempotency-Key header is required" });
    return;
  }

  const payloadHash = hashPayload(req.body);
  const existing = seenRequests.get(idempotencyKey);

  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      // Same key, different request body — this is a client bug.
      // Reject loudly instead of silently returning the wrong cached result.
      res.status(409).json({
        error: "Idempotency-Key reused with a different request payload",
      });
      return;
    }

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

  seenRequests.set(idempotencyKey, { response, payloadHash });

  res.json({ ...response, duplicate: false });
});

const PORT = 8000;
app.listen(PORT, () => {
  console.log(`Idempotent server running on http://localhost:${PORT}`);
});
