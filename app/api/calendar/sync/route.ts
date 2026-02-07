import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, userEventStatusId } from "@/lib/firebase/collections";
import { calendarTitle } from "@/lib/calendar/formatIcs";
import { CALENDAR_INVITE_EMAILS, DEFAULT_TIMEZONE, DEFAULT_EVENT_DURATION_HOURS } from "@/types";
import type { EventStatus } from "@/types";
import { google } from "googleapis";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

const PRIMARY_CALENDAR_EMAIL = process.env.CALENDAR_PRIMARY_EMAIL?.trim() || null;

function toIsoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}-${m}-${day}T${h}:${min}:${s}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const sessionWithToken = session as { user?: { email?: string | null }; accessToken?: string; refreshToken?: string };
  if (!sessionWithToken?.user?.email || !sessionWithToken.accessToken) {
    return NextResponse.json(
      { error: "Connect Google Calendar first (sign in with Google via the Calendar link)" },
      { status: 401 }
    );
  }
  if (
    PRIMARY_CALENDAR_EMAIL != null &&
    sessionWithToken.user.email !== PRIMARY_CALENDAR_EMAIL
  ) {
    return NextResponse.json(
      { error: "Calendar sync is only available for the configured calendar owner" },
      { status: 403 }
    );
  }

  let body: { eventId?: string; status?: string; firebaseUid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventId = body.eventId;
  const status = body.status as EventStatus | undefined;
  const firebaseUid = body.firebaseUid;

  if (
    !eventId ||
    typeof eventId !== "string" ||
    !status ||
    !["interested", "going"].includes(status)
  ) {
    return NextResponse.json(
      { error: "Body must include eventId and status (interested or going)" },
      { status: 400 }
    );
  }
  if (!firebaseUid || typeof firebaseUid !== "string") {
    return NextResponse.json(
      { error: "Body must include firebaseUid to store calendar event id" },
      { status: 400 }
    );
  }

  if (!adminDb) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const eventDoc = await adminDb.collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!eventDoc.exists) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const d = eventDoc.data()!;
  const startAt = d.startAt?.toDate?.() ?? new Date(d.startAt);
  let endAt = d.endAt?.toDate?.() ?? d.endAt ?? null;
  if (!endAt) {
    endAt = new Date(startAt.getTime() + DEFAULT_EVENT_DURATION_HOURS * 60 * 60 * 1000);
  } else if (!(endAt instanceof Date)) {
    endAt = new Date(endAt);
  }
  const rawLoc = d.locationName ?? d.sourceName ?? "";
  const location = rawLoc.trim() ? rawLoc.trim() : (d.sourceName ?? "");
  const title = calendarTitle(d.title ?? "", status);
  const description = d.sourceUrl ?? "";

  const oauth2Client = new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
    process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    access_token: sessionWithToken.accessToken,
    refresh_token: sessionWithToken.refreshToken ?? undefined,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const statusCol = adminDb.collection(COLLECTIONS.USER_EVENT_STATUS);
  const statusDocId = userEventStatusId(firebaseUid, eventId);
  const existingStatus = await statusCol.doc(statusDocId).get();
  const gcalEventId = existingStatus.data()?.gcalEventId as string | undefined;

  const eventResource = {
    summary: title,
    location,
    description,
    start: { dateTime: toIsoLocal(startAt), timeZone: DEFAULT_TIMEZONE },
    end: { dateTime: toIsoLocal(endAt), timeZone: DEFAULT_TIMEZONE },
    attendees: CALENDAR_INVITE_EMAILS.map((email) => ({ email })),
  };

  try {
    let newGcalEventId: string;
    if (gcalEventId) {
      await calendar.events.patch({
        calendarId: "primary",
        eventId: gcalEventId,
        requestBody: {
          summary: title,
          location,
          description,
          start: eventResource.start,
          end: eventResource.end,
          attendees: eventResource.attendees,
        },
        sendUpdates: "all",
      });
      newGcalEventId = gcalEventId;
    } else {
      const res = await calendar.events.insert({
        calendarId: "primary",
        requestBody: eventResource,
        sendUpdates: "all",
      });
      newGcalEventId = res.data.id!;
    }

    await statusCol.doc(statusDocId).set(
      {
        uid: firebaseUid,
        eventId,
        status,
        updatedAt: Timestamp.now(),
        gcalEventId: newGcalEventId,
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, gcalEventId: newGcalEventId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Calendar sync error:", msg);
    return NextResponse.json(
      { error: "Failed to sync to Google Calendar", details: msg },
      { status: 502 }
    );
  }
}
