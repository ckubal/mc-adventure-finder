import { initializeApp, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { cert } from "firebase-admin/app";
import { readFileSync } from "fs";
import { join } from "path";

function getCredential():
  | { type: "service_account"; project_id?: string; [key: string]: unknown }
  | null {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (path) {
    try {
      const resolved = path.startsWith("/") ? path : join(process.cwd(), path);
      const json = readFileSync(resolved, "utf-8");
      return JSON.parse(json) as { type: "service_account"; [key: string]: unknown };
    } catch {
      return null;
    }
  }
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (key) {
    try {
      return JSON.parse(key) as { type: "service_account"; [key: string]: unknown };
    } catch {
      return null;
    }
  }
  return null;
}

let app: App | null = null;
let _adminDb: Firestore | null = null;
let _adminAuth: Auth | null = null;

if (getApps().length === 0) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const cred = getCredential();
  const hasPath = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim());
  const hasKey = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim());
  if (!cred) {
    console.warn(
      "[Firebase Admin] No service account credential loaded. Set FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON key file) or FIREBASE_SERVICE_ACCOUNT_KEY (JSON string) in .env.local. Without it, Firestore will return UNAUTHENTICATED.",
      { hasPath, hasKey, projectId: projectId ?? "(missing)" }
    );
  }
  try {
    app = initializeApp({
      projectId,
      ...(cred ? { credential: cert(cred as Record<string, string>) } : {}),
    });
    _adminDb = getFirestore(app);
    _adminAuth = getAuth(app);
  } catch (e) {
    console.error("Firebase Admin init error (events will be empty until fixed):", e);
    app = null;
    _adminDb = null;
    _adminAuth = null;
  }
} else {
  app = getApps()[0] as App;
  _adminDb = getFirestore(app);
  _adminAuth = getAuth(app);
}

export const adminDb: Firestore | null = _adminDb;
export const adminAuth: Auth | null = _adminAuth;
export default app;
