import { DEFAULT_TIMEZONE } from "@/types";

export type AgendaGroupKey = "today" | "this_week" | "later";

export interface AgendaGroup {
  key: AgendaGroupKey;
  label: string;
  dateLabel?: string; // for "later", we might show "Week of Jan 6" etc.
}

export interface EventWithStart {
  startAt: string; // ISO
}

/** Start of today 00:00 in America/Los_Angeles as a UTC Date. Exported for UI filtering. */
export function startOfTodayLA(): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const datePart = formatter.format(now);
  const [y, m, d] = datePart.split("-").map(Number);
  const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  for (let utcHour = 0; utcHour < 24; utcHour++) {
    const candidate = new Date(Date.UTC(y, m - 1, d, utcHour, 0, 0));
    const inLA = dateTimeFormatter.format(candidate);
    if (inLA.startsWith(datePart) && (inLA.includes("00:00") || inLA.includes("24:00"))) {
      return candidate;
    }
  }
  return new Date(Date.UTC(y, m - 1, d, 8, 0, 0));
}

/** End of "this week" = end of Sunday 23:59:59 LA */
function endOfThisWeek(): Date {
  const todayStart = startOfTodayLA();
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TIMEZONE, weekday: "short" }).format(todayStart);
  const daysToAdd = dayOfWeek === "Sun" ? 0 : { Mon: 6, Tue: 5, Wed: 4, Thu: 3, Fri: 2, Sat: 1 }[dayOfWeek] ?? 0;
  const sundayEnd = new Date(todayStart.getTime() + (daysToAdd + 1) * 24 * 60 * 60 * 1000 - 1);
  return sundayEnd;
}

/** Format a date as YYYY-MM-DD in LA (for same-day comparison) */
function toDateStringLA(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getAgendaGroupKey(startAtIso: string): AgendaGroupKey {
  const start = new Date(startAtIso);
  const todayStart = startOfTodayLA();
  const weekEnd = endOfThisWeek();
  if (start < todayStart) return "later";
  if (start <= weekEnd) {
    if (toDateStringLA(start) === toDateStringLA(todayStart)) return "today";
    return "this_week";
  }
  return "later";
}

export function getGroupLabel(key: AgendaGroupKey, _firstDate?: Date): string {
  switch (key) {
    case "today":
      return "Today";
    case "this_week":
      return "This week";
    case "later":
      return "Later";
    default:
      return "Later";
  }
}

/** Group events into { today, this_week, later }. Each bucket is sorted by startAt. */
export function groupEventsByAgenda<T extends EventWithStart>(
  events: T[]
): Map<AgendaGroupKey, T[]> {
  const map = new Map<AgendaGroupKey, T[]>();
  map.set("today", []);
  map.set("this_week", []);
  map.set("later", []);

  const sorted = [...events].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );

  for (const event of sorted) {
    const key = getAgendaGroupKey(event.startAt);
    map.get(key)!.push(event);
  }

  return map;
}
