/**
 * Launches the cache-stampede server in either mode. Both "naive" and
 * "coalesced" are the same server (see server.ts) — this just picks the
 * starting mode; Live mode in the visualization can switch it afterwards
 * via POST /mode without restarting.
 *
 * Run (from experiments/): npm run cache-stampede:naive / cache-stampede:coalesced
 */

import { start, CacheStampedeServerMode } from "./server";

const requestedMode = process.argv[2];

if (requestedMode !== "naive" && requestedMode !== "coalesced") {
  console.error(`Usage: ts-node start.ts <naive|coalesced> (got "${requestedMode}")`);
  process.exit(1);
}

start(requestedMode as CacheStampedeServerMode);
