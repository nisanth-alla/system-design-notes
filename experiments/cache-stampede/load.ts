/**
 * Fires a burst of concurrent requests for the same key, timed to land
 * right as the cache entry expires — the exact condition that triggers a
 * stampede. Run against either server to see the difference in how many
 * times the (slow) database actually got hit.
 *
 * Run (from experiments/): npm run cache-stampede:load
 */

const PORT = 8001;
const BASE_URL = `http://localhost:${PORT}`;
const KEY = "hot-product-42";
const CONCURRENT_REQUESTS = 20;

async function reset(): Promise<void> {
  await fetch(`${BASE_URL}/reset`, { method: "POST" });
}

async function getStats(): Promise<{ dbCallCount: number }> {
  const res = await fetch(`${BASE_URL}/stats`);
  return res.json();
}

async function fireBurst(): Promise<void> {
  const requests = Array.from({ length: CONCURRENT_REQUESTS }, () =>
    fetch(`${BASE_URL}/item/${KEY}`).then((r) => r.json())
  );
  const results = await Promise.all(requests);

  const sourceCounts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Fired ${CONCURRENT_REQUESTS} concurrent requests for the same key.`);
  console.log("Where each response came from:", sourceCounts);
}

async function main(): Promise<void> {
  await reset();

  console.log(`Warming the cache for "${KEY}" with a single request...\n`);
  await fetch(`${BASE_URL}/item/${KEY}`);

  console.log("Waiting for the cache entry to expire (TTL is 1s)...\n");
  await new Promise((resolve) => setTimeout(resolve, 1100));

  // Reset the counter here so it only reflects the burst below, not the
  // warm-up call above — the warm-up is expected to hit the database once.
  await fetch(`${BASE_URL}/reset-count`, { method: "POST" }).catch(() => {});

  console.log("Cache entry has expired. Firing a burst of concurrent requests...\n");
  await fireBurst();

  const stats = await getStats();
  console.log(`\nDatabase calls made during the burst: ${stats.dbCallCount}`);
  console.log(
    stats.dbCallCount === 1
      ? "Only one request actually reached the database — the rest waited on it or hit the cache."
      : `${stats.dbCallCount} requests reached the database for what should have been ONE cache refill.`
  );
}

main().catch((err) => {
  console.error("Load script failed — is the server running? (npm run cache-stampede:naive / :coalesced)");
  console.error(err);
});
