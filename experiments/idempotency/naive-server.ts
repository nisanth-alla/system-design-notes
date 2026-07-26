/**
 * Naive charge server — no idempotency protection.
 *
 * Every request that hits /charge is processed, no matter how many times
 * the same logical request has already been sent. This exists on purpose,
 * to reproduce the double-charge bug that idempotent-server.ts then fixes.
 *
 * Run (from experiments/): npm run idempotency:naive
 */

import express, { Request, Response } from "express";

interface ChargeRequestBody {
  customerId: string;
  amount: number;
}

const app = express();
app.use(express.json());

let chargeCount = 0;

app.post("/charge", (req: Request<{}, {}, ChargeRequestBody>, res: Response) => {
  const { customerId, amount } = req.body;

  // No memory of past requests — every call is treated as brand new,
  // which is exactly the bug this experiment exists to demonstrate.
  chargeCount += 1;

  res.json({
    status: "charged",
    customerId,
    amount,
    totalChargesForCustomer: chargeCount,
  });
});

const PORT = 8000;
app.listen(PORT, () => {
  console.log(`Naive server (no idempotency) running on http://localhost:${PORT}`);
});
