/**
 * Launches the idempotency server in either mode. Both "naive" and
 * "idempotent" are the same server (see server.ts) — this just picks
 * whether the Idempotency-Key header is enforced at startup; Live mode in
 * the visualization can switch it afterwards via POST /mode without
 * restarting.
 *
 * Run (from experiments/): npm run idempotency:naive / idempotency:idempotent
 */

import { start } from "./server";

const requestedMode = process.argv[2];

if (requestedMode !== "naive" && requestedMode !== "idempotent") {
  console.error(`Usage: ts-node start.ts <naive|idempotent> (got "${requestedMode}")`);
  process.exit(1);
}

start(requestedMode === "idempotent");
