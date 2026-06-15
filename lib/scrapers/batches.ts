/**
 * Scrape batches sized to finish within Render's ~60s route limit.
 * Cron runs one batch per job; the UI loops all batches on refresh.
 */
export const SCRAPE_BATCHES: string[][] = [
  // Fast HTTP / API sources (~15s total)
  [
    "funcheap",
    "envelop",
    "makeoutroom",
    "brickandmortar",
    "booksmith",
    "giants",
    "warriors",
    "roxie",
  ],
  // Medium HTTP + detail enrichment (~45s total)
  ["rickshaw", "cafedunord", "grayarea", "greenapple"],
  // Playwright venue calendars
  ["castro", "independent"],
  // Heavy Playwright (one slow source per batch)
  ["mannys"],
  ["cobbs", "punchline"],
  // Blocked or slow static sites — Playwright fetch
  ["bottomofthehill", "1015folsom", "sfjazz"],
];

export const SCRAPE_BATCH_COUNT = SCRAPE_BATCHES.length;

export function sourceIdsForBatch(batchIndex: number): string[] | null {
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= SCRAPE_BATCHES.length) {
    return null;
  }
  return [...SCRAPE_BATCHES[batchIndex]];
}

export function allBatchedSourceIds(): string[] {
  return SCRAPE_BATCHES.flat();
}
