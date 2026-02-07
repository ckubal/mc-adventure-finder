import { NextRequest, NextResponse } from "next/server";
import { getScrapers } from "@/lib/scrapers/registry";
import { registerAllScrapers } from "@/lib/scrapers/sources";
import { normalizeEvent, eventIdFromSource } from "@/lib/normalize/normalizeEvent";

registerAllScrapers();

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Test endpoint to preview sample events from a specific scraper.
 * GET /api/scrape/test?sourceId=funcheap&limit=5
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url ?? "/", "http://localhost");
  const sourceId = searchParams.get("sourceId");
  const limit = parseInt(searchParams.get("limit") ?? "5", 10);

  if (!sourceId) {
    return NextResponse.json(
      { error: "Missing sourceId query parameter" },
      { status: 400 }
    );
  }

  const scrapers = getScrapers();
  const scraper = scrapers.find((s) => s.id === sourceId);

  if (!scraper) {
    return NextResponse.json(
      { error: `Scraper "${sourceId}" not found. Available: ${scrapers.map((s) => s.id).join(", ")}` },
      { status: 404 }
    );
  }

  try {
    const html = await scraper.fetch();
    const rawList = await Promise.resolve(scraper.parse(html));

    const samples = rawList.slice(0, limit).map((raw) => {
      const eventId = eventIdFromSource(scraper.id, raw.sourceUrl, raw.sourceEventId);
      const normalized = normalizeEvent(raw, scraper.id, scraper.name, eventId);
      return {
        raw: {
          title: raw.title,
          startAt: raw.startAt,
          endAt: raw.endAt,
          locationName: raw.locationName,
          locationAddress: raw.locationAddress,
          sourceUrl: raw.sourceUrl,
          description: raw.description,
        },
        normalized: {
          id: normalized.id,
          title: normalized.title,
          startAt: normalized.startAt.toISOString(),
          endAt: normalized.endAt?.toISOString() ?? null,
          locationName: normalized.locationName,
          locationAddress: normalized.locationAddress,
          sourceUrl: normalized.sourceUrl,
          description: normalized.description,
        },
      };
    });

    return NextResponse.json({
      sourceId: scraper.id,
      sourceName: scraper.name,
      totalFound: rawList.length,
      samples,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Scraper failed: ${msg}`, sourceId: scraper.id },
      { status: 500 }
    );
  }
}
