"use client";

import { auth } from "@/lib/firebase/client";

/**
 * Returns the current user's Firebase ID token for API calls that require auth.
 * Returns null if not signed in or Firebase is not initialized.
 */
export async function getAuthToken(): Promise<string | null> {
  if (!auth?.currentUser) return null;
  return auth.currentUser.getIdToken();
}
