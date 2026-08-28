/**
 * Throwaway CI smoke test — intentional bugs for DevDigest General Reviewer.
 * Delete this file after validating CI findings + Studio ingest.
 */

async function fetchItem(id: string): Promise<string> {
  return `item-${id}`;
}

/** Bug: forEach ignores async callbacks — `results` is still [] when returned. */
export async function loadAll(ids: string[]): Promise<string[]> {
  const results: string[] = [];
  ids.forEach(async (id) => {
    results.push(await fetchItem(id));
  });
  return results;
}

export function divide(a: number, b: number): number {
  return a / b;
}

export function getFirst<T>(items: T[]): T {
  return items[0];
}
