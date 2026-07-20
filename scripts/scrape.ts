/**
 * Standalone scraper entry point for CI (GitHub Actions).
 *
 * This runs the scrapers — including the headless-Chrome ones — inside the CI runner
 * and writes results straight to Firestore, so the Render web service never has to
 * launch a browser (which was OOM-ing its small instance).
 *
 * Usage:
 *   npx tsx scripts/scrape.ts            # all sources
 *   npx tsx scripts/scrape.ts --batch 3  # one batch from SCRAPE_BATCHES
 *   npx tsx scripts/scrape.ts --dry-run  # fetch/parse only, no Firestore writes
 *
 * Credentials come from env (same as the app): FIREBASE_SERVICE_ACCOUNT_KEY (JSON string)
 * or FIREBASE_SERVICE_ACCOUNT_PATH, plus FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID.
 */
import { registerAllScrapers } from "@/lib/scrapers/sources";
import { getScrapers } from "@/lib/scrapers/registry";
import { runScrapers } from "@/lib/scrapers/runScrapers";
import { sourceIdsForBatch, allBatchedSourceIds } from "@/lib/scrapers/batches";
import { adminDb } from "@/lib/firebase/admin";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function main() {
  registerAllScrapers();

  const dryRun = process.argv.includes("--dry-run");
  const batchArg = argValue("--batch");

  let sourceIds: string[];
  if (batchArg != null) {
    const ids = sourceIdsForBatch(Number.parseInt(batchArg, 10));
    if (!ids) {
      console.error(`Invalid --batch ${batchArg}`);
      process.exit(2);
    }
    sourceIds = ids;
  } else {
    sourceIds = allBatchedSourceIds();
  }

  const scrapers = getScrapers().filter((s) => sourceIds.includes(s.id));
  console.log(`[scrape] running ${scrapers.length} sources${dryRun ? " (dry run)" : ""}: ${scrapers.map((s) => s.id).join(", ")}`);

  if (!dryRun && !adminDb) {
    console.error("[scrape] Firebase admin not configured — set FIREBASE_SERVICE_ACCOUNT_KEY and FIREBASE_PROJECT_ID.");
    process.exit(1);
  }

  const t0 = Date.now();
  const results = await runScrapers({ scrapers, dryRun, sequential: true });
  const totalUpserted = results.reduce((sum, r) => sum + r.count, 0);
  const failed = results.filter((r) => r.count === 0 && r.errors.length > 0);

  for (const r of results) {
    const flag = r.count === 0 && r.errors.length > 0 ? "FAIL" : "ok";
    console.log(`  [${flag}] ${r.sourceId}: ${r.count} events${r.errors.length ? ` (${r.errors.length} errors: ${r.errors[0]?.slice(0, 120)})` : ""}`);
  }
  console.log(`[scrape] upserted=${totalUpserted} failed=${failed.map((f) => f.sourceId).join(",") || "none"} in ${Math.round((Date.now() - t0) / 1000)}s`);

  // Keep the health doc fresh (same shape the app expects).
  if (!dryRun && adminDb) {
    try {
      await adminDb.collection("scrapeMeta").doc("health").set(
        {
          lastCronAt: new Date().toISOString(),
          lastBatch: batchArg ?? "all",
          lastResults: results.map((r) => ({ sourceId: r.sourceId, count: r.count, errorCount: r.errors.length })),
          failedSourceIds: failed.map((f) => f.sourceId),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("[scrape] failed to write scrapeMeta/health:", e instanceof Error ? e.message : e);
    }
  }

  // Never fail the run just because a flaky venue returned nothing.
  process.exit(0);
}

main().catch((e) => {
  console.error("[scrape] fatal:", e);
  process.exit(1);
});
