import { NextRequest, NextResponse } from "next/server";
import { getScrapers } from "@/lib/scrapers/registry";
import { registerAllScrapers } from "@/lib/scrapers/sources";

registerAllScrapers();

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Debug endpoint to inspect raw fetched HTML (without dumping everything).
 * GET /api/scrape/debug?sourceId=mannys&needle=Analog
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url ?? "/", "http://localhost");
  const sourceId = searchParams.get("sourceId");
  const needle = searchParams.get("needle") ?? "";

  if (!sourceId) {
    return NextResponse.json({ error: "Missing sourceId query parameter" }, { status: 400 });
  }

  const scrapers = getScrapers();
  const scraper = scrapers.find((s) => s.id === sourceId);
  if (!scraper) {
    return NextResponse.json(
      { error: `Scraper "${sourceId}" not found. Available: ${scrapers.map((s) => s.id).join(", ")}` },
      { status: 404 }
    );
  }

  const html = await scraper.fetch();
  const len = html.length;
  const trimmedStart = html.slice(0, 50);
  const includes = needle ? html.includes(needle) : undefined;
  let context: string | null = null;
  if (needle) {
    const idx = html.indexOf(needle);
    if (idx >= 0) {
      context = html.slice(Math.max(0, idx - 120), Math.min(html.length, idx + 200));
    }
  }

  return NextResponse.json({
    sourceId: scraper.id,
    sourceName: scraper.name,
    len,
    trimmedStart,
    needle: needle || undefined,
    includesNeedle: includes,
    context,
  });
}

