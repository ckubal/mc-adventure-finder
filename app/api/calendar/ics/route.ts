import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { formatEventIcs, formatIcsCalendar } from "@/lib/calendar/formatIcs";
import type { EventStatus } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("eventId");
  const statusParam = searchParams.get("status") as EventStatus | null;

  if (!eventId) {
    return NextResponse.json(
      { error: "Missing eventId" },
      { status: 400 }
    );
  }

  const status =
    statusParam && ["interested", "not_interested", "going"].includes(statusParam)
      ? statusParam
      : "interested";

  if (!adminDb) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const doc = await adminDb.collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!doc.exists) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const d = doc.data()!;
  const startAt = d.startAt?.toDate?.() ?? new Date(d.startAt);
  const endAt = d.endAt?.toDate?.() ?? d.endAt ?? null;
  const endAtDate = endAt instanceof Date ? endAt : endAt ? new Date(endAt) : null;

  const icsEvent = formatEventIcs(
    {
      title: d.title ?? "",
      startAt,
      endAt: endAtDate,
      locationName: d.locationName ?? null,
      sourceName: d.sourceName ?? "",
      sourceUrl: d.sourceUrl ?? "",
    },
    status
  );

  const ics = formatIcsCalendar([icsEvent]);

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="event-${eventId}.ics"`,
    },
  });
}
