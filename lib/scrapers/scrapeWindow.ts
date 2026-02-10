/**
 * Centralized scrape window configuration.
 *
 * The pipeline will still apply its own cutoff, but scrapers that can fetch in
 * pages (APIs, pagination) should aim to pull at least this far ahead so we
 * don't miss events.
 */
export function getScrapeWindowDays(): number {
  const raw = process.env.SCRAPE_WINDOW_DAYS?.trim();
  if (!raw) return 90;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 90;
  return n;
}

export function getScrapeCutoffDate(now = new Date()): Date {
  const days = getScrapeWindowDays();
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
