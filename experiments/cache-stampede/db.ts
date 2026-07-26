/**
 * Simulates the "database" both servers sit in front of.
 *
 * Deliberately slow (300ms) and deliberately counts every call it gets,
 * so we can see exactly how many times the real backend got hit —
 * that count is the whole point of this experiment.
 */

export let dbCallCount = 0;

export function resetDbCallCount(): void {
  dbCallCount = 0;
}

export async function slowDatabaseLookup(key: string): Promise<string> {
  dbCallCount += 1;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return `value-for-${key}-computed-at-${Date.now()}`;
}
