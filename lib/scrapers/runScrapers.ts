import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { normalizeEvent, eventIdFromSource } from "@/lib/normalize/normalizeEvent";
import type { NormalizedEvent } from "@/lib/scrapers/types";
import type { Scraper } from "@/lib/scrapers/types";
import { getScrapeWindowDays } from "@/lib/scrapers/scrapeWindow";

export type ScrapeRunResult = {
  sourceId: string;
  count: number;
  errors: string[];
};

function toFirestoreDoc(normalized: NormalizedEvent): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    id: normalized.id,
    sourceId: normalized.sourceId,
    sourceName: normalized.sourceName,
    sourceUrl: normalized.sourceUrl,
    title: normalized.title,
    startAt: Timestamp.fromDate(normalized.startAt),
    endAt: normalized.endAt ? Timestamp.fromDate(normalized.endAt) : null,
    locationName: normalized.locationName ?? null,
    locationAddress: normalized.locationAddress ?? null,
    description: normalized.description ?? null,
    tags: normalized.tags ?? [],
  };
  // Intentionally omit `raw` — unused by the UI and inflates memory on small Render instances.
  return doc;
}

async function runOneScraper(
  scraper: Scraper,
  opts: { dryRun: boolean; cutoff: Date }
): Promise<ScrapeRunResult> {
  const errors: string[] = [];
  let count = 0;
  const col = adminDb ? adminDb.collection(COLLECTIONS.EVENTS) : null;

  try {
    const html = await scraper.fetch();
    const rawList = await Promise.resolve(scraper.parse(html));

    for (const raw of rawList) {
      try {
        const eventId = eventIdFromSource(scraper.id, raw.sourceUrl, raw.sourceEventId);
        const normalized = normalizeEvent(raw, scraper.id, scraper.name, eventId);
        if (normalized.startAt > opts.cutoff) continue;
        if (!opts.dryRun && col) {
          const doc = toFirestoreDoc(normalized);
          await col.doc(eventId).set(doc, { merge: true });
        }
        count++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Event "${raw.title?.slice(0, 30)}": ${msg}`);
      }
    }
    if (errors.length > 0) {
      console.warn(`[scrape] ${scraper.id}: ${count} events, ${errors.length} errors`, errors.slice(0, 3));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    console.error(`[scrape] ${scraper.id} failed:`, e);
  }

  return { sourceId: scraper.id, count, errors };
}

export type RunScrapersOptions = {
  scrapers: Scraper[];
  dryRun?: boolean;
  /** Run scrapers one after another (safe for batches). Default true when >1 scraper. */
  sequential?: boolean;
  /** Per-scraper timeout; only used when sequential is false. */
  parallelTimeoutMs?: number;
};

/**
 * Run scrapers and upsert into Firestore.
 * Batches should use sequential=true to avoid Playwright races and Render timeouts.
 */
export async function runScrapers(opts: RunScrapersOptions): Promise<ScrapeRunResult[]> {
  const { scrapers, dryRun = false } = opts;
  const sequential = opts.sequential ?? scrapers.length > 1;
  const now = new Date();
  const cutoff = new Date(now.getTime() + getScrapeWindowDays() * 24 * 60 * 60 * 1000);

  if (sequential || scrapers.length <= 1) {
    const results: ScrapeRunResult[] = [];
    for (const scraper of scrapers) {
      results.push(await runOneScraper(scraper, { dryRun, cutoff }));
    }
    return results;
  }

  const parallelTimeoutMs = opts.parallelTimeoutMs ?? 25_000;
  const runWithTimeout = (scraper: Scraper) =>
    Promise.race([
      runOneScraper(scraper, { dryRun, cutoff }),
      new Promise<ScrapeRunResult>((_, reject) =>
        setTimeout(() => reject(new Error("Scraper timeout")), parallelTimeoutMs)
      ),
    ]).catch((err) => ({
      sourceId: scraper.id,
      count: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    }));

  const settled = await Promise.allSettled(scrapers.map((s) => runWithTimeout(s)));
  return settled.map((p) =>
    p.status === "fulfilled" ? p.value : { sourceId: "unknown", count: 0, errors: [String(p.reason)] }
  );
}
