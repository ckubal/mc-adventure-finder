/**
 * Scrape batches sized to finish within Render's ~60s route limit.
 * Cron runs one batch per job; the UI loops all batches on refresh.
 */
export const SCRAPE_BATCHES: string[][] = [
  // Fast HTTP / API sources
  ["funcheap", "envelop", "makeoutroom", "brickandmortar", "booksmith", "giants", "warriors"],
  // Medium HTTP + detail enrichment
  ["rickshaw", "cafedunord", "grayarea", "greenapple"],
  // Playwright venue calendars (one per batch — detail fetches are slow)
  ["castro"],
  ["independent"],
  ["mannys"],
  ["cobbs", "punchline"],
  // Playwright fetches for bot-blocked sites (one per batch)
  ["bottomofthehill"],
  ["1015folsom"],
  ["sfjazz"],
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
