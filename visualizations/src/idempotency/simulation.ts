/**
 * Pure simulation logic for the idempotency visualization — no DOM, no
 * React. Mirrors experiments/idempotency/server.ts (naive vs. idempotent
 * mode): a client retries the same logical purchase 3
 * times because it can't tell whether the first attempt actually landed.
 */

export const RETRY_COUNT = 3;
export const CHARGE_AMOUNT = 50;
export const IDEMPOTENCY_KEY = "purchase-8f14e45f";

export type IdempotencyEvent =
  | { type: "attempt-sent"; attempt: number }
  | { type: "charged"; attempt: number; totalCharges: number }
  | { type: "duplicate-detected"; attempt: number; totalCharges: number };

type Listener = (event: IdempotencyEvent) => void;

export async function runIdempotencyRound(
  useIdempotencyKey: boolean,
  onEvent: Listener
): Promise<void> {
  // The "ledger" the server keeps — same role as the seenRequests Map in
  // server.ts. Reset each round, exactly like restarting the server.
  const ledger = new Set<string>();
  let totalCharges = 0;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    onEvent({ type: "attempt-sent", attempt });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const alreadySeen = useIdempotencyKey && ledger.has(IDEMPOTENCY_KEY);

    if (alreadySeen) {
      onEvent({ type: "duplicate-detected", attempt, totalCharges });
    } else {
      if (useIdempotencyKey) ledger.add(IDEMPOTENCY_KEY);
      totalCharges += 1;
      onEvent({ type: "charged", attempt, totalCharges });
    }
  }
}
