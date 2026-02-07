import { DEFAULT_TIMEZONE, DEFAULT_EVENT_DURATION_HOURS } from "@/types";
import type { EventStatus } from "@/types";

export interface IcsEventInput {
  title: string;
  startAt: Date;
  endAt: Date | null;
  locationName: string | null;
  sourceName: string;
  sourceUrl: string;
}

/**
 * Calendar title per plan: Interested = "[?] " + lowercase; Going = lowercase only.
 */
export function calendarTitle(title: string, status: EventStatus | "interested"): string {
  const lower = title.trim().toLowerCase();
  if (status === "going") return lower;
  return "[?] " + lower;
}

function formatIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Build a single VEVENT in ICS format. End time defaults to start + DEFAULT_EVENT_DURATION_HOURS if missing.
 */
export function formatEventIcs(
  input: IcsEventInput,
  status: EventStatus | "interested" = "interested"
): string {
  const title = calendarTitle(input.title, status);
  const start = input.startAt;
  let end = input.endAt;
  if (!end) {
    end = new Date(start.getTime() + DEFAULT_EVENT_DURATION_HOURS * 60 * 60 * 1000);
  }
  const location = (input.locationName ?? input.sourceName).trim() || input.sourceName;
  const description = input.sourceUrl;

  const uid = `sf-events-${start.getTime()}@local`;
  const now = new Date();
  const stamp = formatIcsDate(now);
  const dtStart = formatIcsDate(start);
  const dtEnd = formatIcsDate(end);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    "END:VEVENT",
  ];
  return lines.join("\r\n");
}

export function formatIcsCalendar(vevents: string[]): string {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SF Events//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-TIMEZONE:" + DEFAULT_TIMEZONE,
  ];
  const footer = ["END:VCALENDAR"];
  return [...header, ...vevents, ...footer].join("\r\n");
}
