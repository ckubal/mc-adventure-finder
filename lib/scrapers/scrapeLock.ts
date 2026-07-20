/**
 * In-process lock so cron + UI refresh never run overlapping Playwright scrapes.
 * Chromium on a 512MB Render instance will OOM if two browsers launch at once.
 */
let locked = false;
let lockedAt: number | null = null;
const STALE_MS = 5 * 60_000;

export function tryAcquireScrapeLock(): boolean {
  if (locked) {
    if (lockedAt != null && Date.now() - lockedAt > STALE_MS) {
      locked = false;
      lockedAt = null;
    } else {
      return false;
    }
  }
  locked = true;
  lockedAt = Date.now();
  return true;
}

export function releaseScrapeLock(): void {
  locked = false;
  lockedAt = null;
}
