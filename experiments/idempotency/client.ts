/**
 * Simulates a client that can't tell whether its request actually landed —
 * so, like a real HTTP client after a timeout, it retries the same logical
 * purchase 3 times. Run this against either server to see the difference.
 *
 * Run (from experiments/): npm run idempotency:client
 * (point ADD_IDEMPOTENCY_KEY at true/false below, or pass it as an env var)
 */

export {}; // makes this file a module, so its top-level names don't collide
           // with cache-stampede/load.ts under a whole-project type-check

const PORT = 8000;
const BASE_URL = `http://localhost:${PORT}`;

// Same key for every attempt in this run — a real client would generate
// this once per logical purchase (e.g. when the user taps "buy") and reuse
// it across retries of that same purchase.
const idempotencyKey = "purchase-8f14e45f-abc123";

const useIdempotencyKey = process.env.ADD_IDEMPOTENCY_KEY !== "false";

async function attemptCharge(attempt: number): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (useIdempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetch(`${BASE_URL}/charge`, {
    method: "POST",
    headers,
    body: JSON.stringify({ customerId: "customer_1", amount: 50 }),
  });

  const body = await res.json();
  console.log(`Attempt ${attempt}:`, body);
}

async function main() {
  console.log(
    `Simulating 3 retries of the same purchase (idempotency key ${
      useIdempotencyKey ? "sent" : "NOT sent"
    })\n`
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    await attemptCharge(attempt);
  }
}

main().catch((err) => {
  console.error("Client failed — is the server running? (npm run idempotency:naive / idempotency:idempotent)");
  console.error(err);
});
