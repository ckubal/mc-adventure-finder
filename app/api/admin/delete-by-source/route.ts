import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

export const dynamic = "force-dynamic";

/** POST body: { sourceId: string }. Deletes all events with that sourceId. */
export async function POST(req: NextRequest) {
  if (!adminDb) {
    return NextResponse.json({ error: "Firebase not configured" }, { status: 503 });
  }
  let body: { sourceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const sourceId = body.sourceId?.trim();
  if (!sourceId) {
    return NextResponse.json(
      { error: "Body must include sourceId (e.g. \"roxie\")" },
      { status: 400 }
    );
  }

  const col = adminDb.collection(COLLECTIONS.EVENTS);
  const snapshot = await col.where("sourceId", "==", sourceId).get();
  const BATCH_SIZE = 500;
  let deleted = 0;
  for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
    const batch = adminDb.batch();
    snapshot.docs.slice(i, i + BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, snapshot.docs.length - i);
  }

  return NextResponse.json({ ok: true, deleted, sourceId });
}
