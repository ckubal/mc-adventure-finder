import { NextRequest, NextResponse } from "next/server";
import { getScrapers } from "@/lib/scrapers/registry";
import { registerAllScrapers } from "@/lib/scrapers/sources";
import { normalizeEvent, eventIdFromSource } from "@/lib/normalize/normalizeEvent";
import { getScrapeWindowDays } from "@/lib/scrapers/scrapeWindow";

registerAllScrapers();

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url ?? "/", "http://localhost");
  const perSourceTimeoutMs = Number.parseInt(searchParams.get("timeoutMs") ?? "25000", 10) || 25_000;
  const includeErrors = searchParams.get("includeErrors") === "true";

  const now = new Date();
  const scrapeWindowDays = getScrapeWindowDays();
  const cutoffs = [7, 30, scrapeWindowDays, 180];

  const scrapers = getScrapers();

  async function summarizeOne(scraper: (typeof scrapers)[0]) {
    const errors: string[] = [];
    let totalRaw = 0;
    let normalizedOk = 0;
    let minStart: Date | null = null;
    let maxStart: Date | null = null;
    const counts: Record<string, number> = {};
    for (const c of cutoffs) counts[String(c)] = 0;
    counts.future = 0;
    counts.past = 0;

    try {
      const html = await scraper.fetch();
      const rawList = await Promise.resolve(scraper.parse(html));
      totalRaw = rawList.length;

      for (const raw of rawList) {
        try {
          const eventId = eventIdFromSource(scraper.id, raw.sourceUrl, raw.sourceEventId);
          const normalized = normalizeEvent(raw, scraper.id, scraper.name, eventId);
          normalizedOk++;

          const start = normalized.startAt;
          if (minStart == null || start < minStart) minStart = start;
          if (maxStart == null || start > maxStart) maxStart = start;

          const deltaDays = daysBetween(now, start);
          if (deltaDays >= 0) counts.future++;
          else counts.past++;

          for (const c of cutoffs) {
            if (deltaDays >= 0 && deltaDays <= c) counts[String(c)]++;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`Event "${raw.title?.slice(0, 40) ?? "?"}": ${msg}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
    }

    const spanDays =
      minStart && maxStart ? Math.round(daysBetween(minStart, maxStart)) : null;
    const maxDaysAhead =
      maxStart ? Math.round(daysBetween(now, maxStart)) : null;

    return {
      sourceId: scraper.id,
      sourceName: scraper.name,
      totalRaw,
      normalizedOk,
      minStartAt: minStart?.toISOString() ?? null,
      maxStartAt: maxStart?.toISOString() ?? null,
      spanDays,
      maxDaysAhead,
      counts,
      ...(includeErrors ? { errors: errors.slice(0, 20) } : {}),
      errorCount: errors.length,
    };
  }

  const runWithTimeout = (s: (typeof scrapers)[0]) =>
    Promise.race([
      summarizeOne(s),
      new Promise<ReturnType<typeof summarizeOne>>((_, reject) =>
        setTimeout(() => reject(new Error("Scraper timeout")), perSourceTimeoutMs)
      ),
    ]).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        sourceId: s.id,
        sourceName: s.name,
        totalRaw: 0,
        normalizedOk: 0,
        minStartAt: null,
        maxStartAt: null,
        spanDays: null,
        maxDaysAhead: null,
        counts: { "7": 0, "30": 0, [String(scrapeWindowDays)]: 0, "180": 0, future: 0, past: 0 },
        ...(includeErrors ? { errors: [msg] } : {}),
        errorCount: 1,
      };
    });

  const results = await Promise.all(scrapers.map((s) => runWithTimeout(s)));
  results.sort((a, b) => (b.maxDaysAhead ?? -999999) - (a.maxDaysAhead ?? -999999));

  return NextResponse.json({
    now: now.toISOString(),
    scrapeWindowDays,
    perSourceTimeoutMs,
    sources: results,
  });
}

