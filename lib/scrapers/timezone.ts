import { DEFAULT_TIMEZONE } from "@/types";

export interface ZonedDateTimeParts {
  /** Full year, e.g. 2026 */
  year: number;
  /** Month 1-12 */
  month: number;
  /** Day 1-31 */
  day: number;
  /** 0-23 */
  hour?: number;
  /** 0-59 */
  minute?: number;
  /** 0-59 */
  second?: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  formatters.set(timeZone, fmt);
  return fmt;
}

function partsInTimeZone(date: Date, timeZone: string): Required<ZonedDateTimeParts> {
  const fmt = getFormatter(timeZone);
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const year = Number.parseInt(get("year"), 10);
  const month = Number.parseInt(get("month"), 10);
  const day = Number.parseInt(get("day"), 10);
  const hour = Number.parseInt(get("hour"), 10);
  const minute = Number.parseInt(get("minute"), 10);
  const second = Number.parseInt(get("second"), 10);
  return { year, month, day, hour, minute, second };
}

/**
 * Convert a local date/time in a specific IANA timezone into a UTC Date.
 *
 * We avoid `new Date(y, m, d, h...)` because that depends on the server's local TZ
 * (Render is UTC), which causes SF evening events to show up as late morning/noon.
 *
 * This uses an iterative correction method similar to date-fns-tz's `zonedTimeToUtc`.
 */
export function dateFromZonedParts(
  parts: ZonedDateTimeParts,
  timeZone = DEFAULT_TIMEZONE
): Date {
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = parts.hour ?? 0;
  const minute = parts.minute ?? 0;
  const second = parts.second ?? 0;

  // Initial guess: interpret desired local time as UTC.
  let utcMillis = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const desiredLocalMillis = Date.UTC(year, month - 1, day, hour, minute, second, 0);

  // Correct 2-3 times to converge (handles DST shifts).
  for (let i = 0; i < 3; i++) {
    const guess = new Date(utcMillis);
    const got = partsInTimeZone(guess, timeZone);
    const gotLocalMillis = Date.UTC(
      got.year,
      got.month - 1,
      got.day,
      got.hour,
      got.minute,
      got.second,
      0
    );
    const diff = desiredLocalMillis - gotLocalMillis;
    if (diff === 0) break;
    utcMillis += diff;
  }

  return new Date(utcMillis);
}

export function isoFromZonedParts(
  parts: ZonedDateTimeParts,
  timeZone = DEFAULT_TIMEZONE
): string {
  return dateFromZonedParts(parts, timeZone).toISOString();
}

function hasExplicitOffset(iso: string): boolean {
  // Ends with Z or has a numeric offset like -08:00 / +0000
  return /[zZ]$/.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso);
}

/**
 * Parse an ISO-like string to an ISO string.
 * - If it already includes an offset/Z, use built-in Date parsing.
 * - If it omits an offset (e.g. "2026-02-12T20:00"), interpret it as local time
 *   in the provided timezone (defaults to America/Los_Angeles).
 */
export function parseIsoAssumingTimeZone(
  iso: string,
  timeZone = DEFAULT_TIMEZONE
): string | null {
  if (!iso || typeof iso !== "string") return null;
  const s = iso.trim();
  if (!s) return null;

  if (hasExplicitOffset(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!m) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const day = Number.parseInt(m[3], 10);
  const hour = Number.parseInt(m[4], 10);
  const minute = Number.parseInt(m[5], 10);
  const second = m[6] ? Number.parseInt(m[6], 10) : 0;

  if (!year || !month || !day) return null;
  return isoFromZonedParts({ year, month, day, hour, minute, second }, timeZone);
}

