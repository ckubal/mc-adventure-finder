import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

export const dynamic = "force-dynamic";

const CTA_TITLES = ["Buy Tickets", "Buy Ticket", "More Info", "Get Tickets", "Tickets", "SHOW MOVED", "Show Moved"];

/** POST: delete events whose title is exactly one of the CTA phrases (removes duplicate/bad entries). */
export async function POST(req: NextRequest) {
  if (!adminDb) {
    return NextResponse.json({ error: "Firebase not configured" }, { status: 503 });
  }

  const col = adminDb.collection(COLLECTIONS.EVENTS);
  let deleted = 0;
  const BATCH_SIZE = 500;

  for (const title of CTA_TITLES) {
    const snapshot = await col.where("title", "==", title).get();
    for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      const chunk = snapshot.docs.slice(i, i + BATCH_SIZE);
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += chunk.length;
    }
  }

  return NextResponse.json({ ok: true, deleted });
}
