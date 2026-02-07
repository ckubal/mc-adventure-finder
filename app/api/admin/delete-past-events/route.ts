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

/** POST: Delete all events with startAt before today (LA time). Cleans out past/garbage events. */
export async function POST() {
  if (!adminDb) {
    return NextResponse.json({ error: "Firebase not configured" }, { status: 503 });
  }
  const col = adminDb.collection(COLLECTIONS.EVENTS);
  const cutoff = startOfTodayLA();
  const snapshot = await col.where("startAt", "<", cutoff).get();
  const BATCH_SIZE = 500;
  let deleted = 0;
  for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
    const batch = adminDb.batch();
    snapshot.docs.slice(i, i + BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.docs.slice(i, i + BATCH_SIZE).length;
  }
  return NextResponse.json({ ok: true, deleted, cutoff: cutoff.toISOString() });
}
