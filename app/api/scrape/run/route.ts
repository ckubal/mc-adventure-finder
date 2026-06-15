import { NextRequest, NextResponse } from "next/server";
import { getScrapers } from "@/lib/scrapers/registry";
import { registerAllScrapers } from "@/lib/scrapers/sources";
import { adminDb } from "@/lib/firebase/admin";
import { runScrapers } from "@/lib/scrapers/runScrapers";
import {
  SCRAPE_BATCH_COUNT,
  sourceIdsForBatch,
  allBatchedSourceIds,
} from "@/lib/scrapers/batches";

registerAllScrapers();

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const dryRun = url.searchParams.get("dryRun") === "true";
  const onlySourceId = url.searchParams.get("sourceId")?.trim() || null;
  const onlySourceIds = (url.searchParams.get("sourceIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const batchParam = url.searchParams.get("batch")?.trim() ?? null;

  if (!dryRun && !adminDb) {
    return NextResponse.json(
      { ok: false, totalUpserted: 0, results: [], error: "Firebase not configured" },
      { status: 503 }
    );
  }

  const allScrapers = getScrapers();
  let filterSet = new Set<string>([
    ...(onlySourceId ? [onlySourceId] : []),
    ...onlySourceIds,
  ]);

  let batchIndex: number | null = null;
  if (batchParam != null && batchParam !== "") {
    batchIndex = Number.parseInt(batchParam, 10);
    if (!Number.isInteger(batchIndex)) {
      return NextResponse.json({ ok: false, error: "Invalid batch index" }, { status: 400 });
    }
    const batchIds = sourceIdsForBatch(batchIndex);
    if (!batchIds) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid batch ${batchIndex}. Valid: 0–${SCRAPE_BATCH_COUNT - 1}`,
        },
        { status: 400 }
      );
    }
    filterSet = new Set(batchIds);
  }

  const scrapers =
    filterSet.size > 0
      ? allScrapers.filter((s) => filterSet.has(s.id))
      : allScrapers;

  if (filterSet.size > 0 && scrapers.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        totalUpserted: 0,
        results: [],
        error: `No matching scrapers. Requested: ${Array.from(filterSet).join(", ")}. Available: ${allScrapers.map((s) => s.id).join(", ")}`,
      },
      { status: 404 }
    );
  }

  // Full refresh must use batches — running all scrapers in one request exceeds Render limits.
  if (filterSet.size === 0 || (filterSet.size === allScrapers.length && batchParam == null)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Use batch=0..${SCRAPE_BATCH_COUNT - 1} or sourceId/sourceIds. Batched ids: ${allBatchedSourceIds().join(", ")}`,
      },
      { status: 400 }
    );
  }

  const sequential = batchParam != null || scrapers.length > 1;
  const results = await runScrapers({ scrapers, dryRun, sequential });
  const totalUpserted = results.reduce((sum, r) => sum + r.count, 0);

  return NextResponse.json({
    ok: true,
    dryRun: dryRun || undefined,
    batch: batchIndex ?? undefined,
    totalUpserted,
    results,
  });
}
