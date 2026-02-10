import { NextRequest, NextResponse } from "next/server";
import { getScrapers } from "@/lib/scrapers/registry";
import { registerAllScrapers } from "@/lib/scrapers/sources";
import { normalizeEvent, eventIdFromSource } from "@/lib/normalize/normalizeEvent";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { Timestamp } from "firebase-admin/firestore";
import type { NormalizedEvent } from "@/lib/scrapers/types";
import { getScrapeWindowDays } from "@/lib/scrapers/scrapeWindow";

registerAllScrapers();

/** Firestore does not allow undefined. Strip undefined and convert to a safe document. */
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
  if (normalized.raw != null && typeof normalized.raw === "object" && Object.keys(normalized.raw).length > 0) {
    doc.raw = normalized.raw;
  }
  return doc;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const dryRun = new URL(req.url ?? "/", "http://localhost").searchParams.get("dryRun") === "true";

  if (!dryRun && !adminDb) {
    return NextResponse.json(
      { ok: false, totalUpserted: 0, results: [], error: "Firebase not configured" },
      { status: 503 }
    );
  }
  const scrapers = getScrapers();
  const col = adminDb ? adminDb.collection(COLLECTIONS.EVENTS) : null;
  const SCRAPER_TIMEOUT_MS = 25_000;
  const now = new Date();
  /** Only upsert events starting within this many days from now (default: next 3 months). */
  const SCRAPE_WINDOW_DAYS = getScrapeWindowDays();
  const cutoff = new Date(now.getTime() + SCRAPE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  async function runScraper(scraper: (typeof scrapers)[0]) {
    const errors: string[] = [];
    let count = 0;
    try {
      const html = await scraper.fetch();
      const rawList = await Promise.resolve(scraper.parse(html));

      for (const raw of rawList) {
        try {
          const eventId = eventIdFromSource(
            scraper.id,
            raw.sourceUrl,
            raw.sourceEventId
          );
          const normalized = normalizeEvent(
            raw,
            scraper.id,
            scraper.name,
            eventId
          );
          if (normalized.startAt > cutoff) continue; // beyond scrape window: skip
          if (!dryRun && col) {
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

  const runWithTimeout = (s: (typeof scrapers)[0]) =>
    Promise.race([
      runScraper(s),
      new Promise<{ sourceId: string; count: number; errors: string[] }>((_, reject) =>
        setTimeout(() => reject(new Error("Scraper timeout")), SCRAPER_TIMEOUT_MS)
      ),
    ]).catch((err) => {
      console.warn(`[scrape] ${s.id} timed out or failed:`, err);
      return { sourceId: s.id, count: 0, errors: [err instanceof Error ? err.message : String(err)] };
    });

  const settled = await Promise.allSettled(scrapers.map((s) => runWithTimeout(s)));
  const results = settled.map((p) =>
    p.status === "fulfilled" ? p.value : { sourceId: "unknown", count: 0, errors: [String(p.reason)] }
  );
  const totalUpserted = results.reduce((sum, r) => sum + r.count, 0);

  return NextResponse.json({
    ok: true,
    dryRun: dryRun || undefined,
    totalUpserted: dryRun ? totalUpserted : totalUpserted,
    results,
  });
}
