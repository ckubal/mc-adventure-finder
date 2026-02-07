import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, userEventStatusId } from "@/lib/firebase/collections";
import { Timestamp } from "firebase-admin/firestore";
import type { EventStatus } from "@/types";

export const dynamic = "force-dynamic";

async function getUidFromRequest(req: NextRequest): Promise<string | null> {
  if (!adminAuth) return null;
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

export interface UserStatusItem {
  eventId: string;
  status: EventStatus;
  updatedAt: string;
}

/** GET: list current user's event statuses */
export async function GET(req: NextRequest) {
  if (!adminDb) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const uid = await getUidFromRequest(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const col = adminDb.collection(COLLECTIONS.USER_EVENT_STATUS);
  const snapshot = await col.where("uid", "==", uid).get();

  const statuses: UserStatusItem[] = snapshot.docs.map((doc) => {
    const d = doc.data();
    const updatedAt = d.updatedAt?.toDate?.() ?? d.updatedAt;
    return {
      eventId: d.eventId,
      status: d.status as EventStatus,
      updatedAt:
        updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt),
    };
  });

  return NextResponse.json({ statuses });
}

/** POST: set status for one event. Body: { eventId: string, status: EventStatus } */
export async function POST(req: NextRequest) {
  const uid = await getUidFromRequest(req);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { eventId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const eventId = body.eventId;
  const status = body.status;

  if (
    !eventId ||
    typeof eventId !== "string" ||
    !status ||
    !["interested", "not_interested", "going"].includes(status)
  ) {
    return NextResponse.json(
      { error: "Body must include eventId and status (interested | not_interested | going)" },
      { status: 400 }
    );
  }

  if (!adminDb) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const docId = userEventStatusId(uid, eventId);
  const col = adminDb.collection(COLLECTIONS.USER_EVENT_STATUS);
  await col.doc(docId).set(
    {
      uid,
      eventId,
      status: status as EventStatus,
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, eventId, status });
}
