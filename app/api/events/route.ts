import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { DEFAULT_TIMEZONE } from "@/types";

export const dynamic = "force-dynamic";

const DATE_PART_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Start of a calendar day 00:00:00 in America/Los_Angeles as a UTC Date (for Firestore). */
function startOfDayLA(year: number, month: number, day: number): Date {
  const datePart = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  for (let utcHour = 0; utcHour < 24; utcHour++) {
    const candidate = new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0));
    const inLA = DATE_TIME_FORMATTER.format(candidate);
    if (inLA.startsWith(datePart) && (inLA.includes("00:00") || inLA.includes("24:00"))) {
      return candidate;
    }
  }
  return new Date(Date.UTC(year, month - 1, day, 8, 0, 0));
}

/** End of a calendar day 23:59:59.999 in America/Los_Angeles as a UTC Date (for Firestore). */
function endOfDayLA(year: number, month: number, day: number): Date {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const y2 = next.getUTCFullYear();
  const m2 = next.getUTCMonth() + 1;
  const d2 = next.getUTCDate();
  const startNext = startOfDayLA(y2, m2, d2);
  return new Date(startNext.getTime() - 1);
}

/** Start of today 00:00:00 in America/Los_Angeles as a UTC Date for Firestore comparison */
function startOfTodayLA(): Date {
  const now = new Date();
  const datePart = DATE_PART_FORMATTER.format(now);
  const [y, m, d] = datePart.split("-").map(Number);
  return startOfDayLA(y, m, d);
}

/** Parse YYYY-MM-DD from query param; return null if invalid. */
function parseDateParam(value: string | null): { year: number; month: number; day: number } | null {
  if (!value || typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
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

export async function GET(request: NextRequest) {
  if (!adminDb) {
    return NextResponse.json({ events: [] });
  }
  try {
    const col = adminDb.collection(COLLECTIONS.EVENTS);
    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    let startBound: Date;
    let endBound: Date | null = null;

    const startParsed = parseDateParam(startParam);
    const endParsed = parseDateParam(endParam);

    if (startParsed) {
      startBound = startOfDayLA(startParsed.year, startParsed.month, startParsed.day);
    } else {
      startBound = startOfTodayLA();
    }
    if (endParsed) {
      endBound = endOfDayLA(endParsed.year, endParsed.month, endParsed.day);
    }

    const snapshot =
      endBound !== null
        ? await col
            .where("startAt", ">=", startBound)
            .where("startAt", "<=", endBound)
            .orderBy("startAt", "asc")
            .limit(500)
            .get()
        : await col
            .where("startAt", ">=", startBound)
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
        // Omit Firestore `raw` — unused by the UI and can be large.
      };
    });

    return NextResponse.json({ events });
  } catch (e) {
    console.error("GET /api/events error:", e);
    return NextResponse.json({ events: [] });
  }
}
