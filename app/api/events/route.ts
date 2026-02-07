import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { DEFAULT_TIMEZONE } from "@/types";

export const dynamic = "force-dynamic";

/** Start of today 00:00:00 in America/Los_Angeles as a UTC Date for Firestore comparison */
function startOfTodayLA(): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const datePart = formatter.format(now);
  const [y, m, d] = datePart.split("-").map(Number);
  // Midnight today in LA = some hour UTC (7 or 8 depending on DST). Find it.
  const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  for (let utcHour = 0; utcHour < 24; utcHour++) {
    const candidate = new Date(Date.UTC(y, m - 1, d, utcHour, 0, 0));
    const inLA = dateTimeFormatter.format(candidate);
    if (inLA.startsWith(datePart) && (inLA.includes("00:00") || inLA.includes("24:00"))) {
      return candidate;
    }
  }
  return new Date(Date.UTC(y, m - 1, d, 8, 0, 0));
}

export interface ApiEvent {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  title: string;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  description: string | null;
  tags: string[];
  raw?: Record<string, unknown>;
}

export async function GET() {
  if (!adminDb) {
    return NextResponse.json({ events: [] });
  }
  try {
    const col = adminDb.collection(COLLECTIONS.EVENTS);
    const start = startOfTodayLA();
    const snapshot = await col
      .where("startAt", ">=", start)
      .orderBy("startAt", "asc")
      .limit(500)
      .get();

    const events: ApiEvent[] = snapshot.docs.map((doc) => {
      const d = doc.data();
      const startAt = d.startAt?.toDate?.() ?? d.startAt;
      const endAt = d.endAt?.toDate?.() ?? d.endAt ?? null;
      return {
        id: doc.id,
        sourceId: d.sourceId,
        sourceName: d.sourceName,
        sourceUrl: d.sourceUrl,
        title: d.title,
        startAt: startAt instanceof Date ? startAt.toISOString() : String(startAt),
        endAt:
          endAt instanceof Date
            ? endAt.toISOString()
            : endAt != null
              ? String(endAt)
              : null,
        locationName: d.locationName ?? null,
        locationAddress: d.locationAddress ?? null,
        description: d.description ?? null,
        tags: Array.isArray(d.tags) ? d.tags : [],
        raw: d.raw,
      };
    });

    return NextResponse.json({ events });
  } catch (e) {
    console.error("GET /api/events error:", e);
    return NextResponse.json({ events: [] });
  }
}
