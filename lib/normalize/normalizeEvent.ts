import { DEFAULT_TIMEZONE } from "@/types";
import type { RawEvent, NormalizedEvent } from "@/lib/scrapers/types";
import { parseIsoAssumingTimeZone } from "@/lib/scrapers/timezone";

const LA_TZ = DEFAULT_TIMEZONE;

function parseToDate(value: string | Date, tz: string): Date {
  if (value instanceof Date) return value;
  const str = typeof value === "string" ? value.trim() : String(value);
  // Offset-less ISO (e.g. "2026-02-13T20:00:00") is interpreted as LA, not UTC, so evening events don't show as noon.
  const iso = parseIsoAssumingTimeZone(str, tz);
  const d = iso ? new Date(iso) : new Date(str);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

function toEndDate(start: Date, end: string | Date | null | undefined): Date | null {
  if (end == null || end === "") return null;
  if (end instanceof Date) return Number.isNaN(end.getTime()) ? null : end;
  const iso = parseIsoAssumingTimeZone(end.trim(), LA_TZ);
  const d = new Date(iso ?? end);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Normalize a raw event: ensure startAt/endAt are Date in LA semantics,
 * default endAt to startAt + 2h if missing, trim title, fallback location to source name.
 */
export function normalizeEvent(
  raw: RawEvent,
  sourceId: string,
  sourceName: string,
  eventId: string
): NormalizedEvent {
  const startAt = parseToDate(raw.startAt, LA_TZ);
  const endAt = toEndDate(startAt, raw.endAt);

  const locationName =
    raw.locationName?.trim() || raw.locationAddress?.trim() || null;
  const locationAddress = raw.locationAddress?.trim() || null;
  const locationFallback = locationName || sourceName;

  return {
    id: eventId,
    sourceId,
    sourceName,
    sourceUrl: raw.sourceUrl.trim(),
    title: raw.title.trim(),
    startAt,
    endAt,
    locationName: locationFallback || null,
    locationAddress: locationAddress || null,
    description: raw.description?.trim() || null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    raw: raw.raw,
  };
}

/**
 * Generate a stable event id from source and url/event id for deduplication.
 */
export function eventIdFromSource(sourceId: string, sourceUrl: string, sourceEventId?: string): string {
  const seed = sourceEventId || sourceUrl;
  let hash = 0;
  const str = `${sourceId}:${seed}`;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = (hash << 5) - hash + c;
    hash |= 0;
  }
  return `${sourceId}_${Math.abs(hash).toString(36)}`;
}
