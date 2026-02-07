import { NextResponse } from "next/server";
import { getScrapers } from "@/lib/scrapers/registry";
import { registerAllScrapers } from "@/lib/scrapers/sources";

registerAllScrapers();

export const dynamic = "force-dynamic";

export async function GET() {
  const scrapers = getScrapers();
  return NextResponse.json({
    scrapers: scrapers.map((s) => ({
      id: s.id,
      name: s.name,
    })),
  });
}
