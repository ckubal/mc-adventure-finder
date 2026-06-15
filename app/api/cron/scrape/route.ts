import { NextRequest, NextResponse } from "next/server";
import { getScrapers } from "@/lib/scrapers/registry";
import { registerAllScrapers } from "@/lib/scrapers/sources";
import { adminDb } from "@/lib/firebase/admin";
import { runScrapers } from "@/lib/scrapers/runScrapers";
import {
  SCRAPE_BATCH_COUNT,
  sourceIdsForBatch,
} from "@/lib/scrapers/batches";
import { isScrapeAuthorized } from "@/lib/scrapers/scrapeAuth";

registerAllScrapers();

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Render cron entry point — runs one scrape batch per invocation.
 * GET /api/cron/scrape?batch=0
 * Authorization: Bearer $SCRAPE_SECRET (required when SCRAPE_SECRET is set)
 */
export async function GET(req: NextRequest) {
  if (!isScrapeAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!adminDb) {
    return NextResponse.json({ ok: false, error: "Firebase not configured" }, { status: 503 });
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const batchParam = url.searchParams.get("batch")?.trim() ?? "0";

  let batchIds: string[] | null;
  let batchIndex: number | null;

  if (batchParam === "retry") {
    const metaDoc = await adminDb.collection("scrapeMeta").doc("health").get();
    const failed = (metaDoc.data()?.failedSourceIds as string[] | undefined) ?? [];
    batchIds = failed.length > 0 ? failed : null;
    batchIndex = null;
    if (!batchIds) {
      return NextResponse.json({ ok: true, batch: "retry", totalUpserted: 0, results: [], message: "No failed sources to retry" });
    }
  } else {
    batchIndex = Number.parseInt(batchParam, 10);
    if (!Number.isInteger(batchIndex)) {
      return NextResponse.json({ ok: false, error: "Invalid batch index" }, { status: 400 });
    }
    batchIds = sourceIdsForBatch(batchIndex);
    if (!batchIds) {
      return NextResponse.json(
        { ok: false, error: `Invalid batch ${batchIndex}. Valid: 0–${SCRAPE_BATCH_COUNT - 1} or retry` },
        { status: 400 }
      );
    }
  }

  const scrapers = getScrapers().filter((s) => batchIds!.includes(s.id));
  const results = await runScrapers({ scrapers, dryRun: false, sequential: true });
  const totalUpserted = results.reduce((sum, r) => sum + r.count, 0);
  const failed = results.filter((r) => r.count === 0 && r.errors.length > 0);

  if (batchParam !== "retry") {
    const metaDoc = await adminDb.collection("scrapeMeta").doc("health").get();
    const prevFailed = (metaDoc.data()?.failedSourceIds as string[] | undefined) ?? [];
    const succeededThisBatch = new Set(
      results.filter((r) => r.count > 0).map((r) => r.sourceId)
    );
    const stillFailed = prevFailed.filter((id) => !succeededThisBatch.has(id));
    const newFailed = failed.map((f) => f.sourceId);
    const failedSourceIds = [...new Set([...stillFailed, ...newFailed])];

    await adminDb.collection("scrapeMeta").doc("health").set(
      {
        lastCronAt: new Date().toISOString(),
        lastBatch: batchParam,
        lastResults: results.map((r) => ({ sourceId: r.sourceId, count: r.count, errorCount: r.errors.length })),
        failedSourceIds,
      },
      { merge: true }
    );
  }

  console.info(
    `[cron/scrape] batch=${batchIndex} upserted=${totalUpserted} failed=${failed.map((f) => f.sourceId).join(",") || "none"}`
  );

  return NextResponse.json({
    ok: true,
    batch: batchParam === "retry" ? "retry" : batchIndex,
    totalUpserted,
    results,
    failedSourceIds: failed.map((f) => f.sourceId),
  });
}
