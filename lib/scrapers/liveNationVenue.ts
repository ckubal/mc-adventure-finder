import { getScrapeCutoffDate } from "./scrapeWindow";

export interface LiveNationVenueEvent {
  tm_id?: string;
  discovery_id?: string;
  id?: string;
  name?: string;
  url?: string;
  datetime_local?: string; // e.g. 2026-02-11T19:30:00-08:00
  start_datetime_utc?: string; // e.g. 2026-02-12T03:30:00Z
  start_date_local?: string; // e.g. 2026-02-11
  start_time_local?: string; // e.g. 19:30:00
  timezone?: string; // e.g. America/Los_Angeles
  important_info?: string;
  venue?: {
    name?: string;
    location?: {
      street_address?: string;
      locality?: string;
      region?: string;
      postal_code?: string;
      country?: string;
    };
  };
  venue_name?: string;
}

function parseEventStart(ev: LiveNationVenueEvent): Date | null {
  const s = (typeof ev.datetime_local === "string" && ev.datetime_local) ||
    (typeof ev.start_datetime_utc === "string" && ev.start_datetime_utc) ||
    null;
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function fetchLiveNationVenueEventsJson(opts: {
  /** Live Nation venue discovery id (e.g. KovZpZAEkFEA). */
  venueId: string;
  /** The venue's public shows page (used to establish session). */
  showsUrl: string;
  /** How many days ahead to fetch (default from SCRAPE_WINDOW_DAYS). */
  maxDaysAhead?: number;
  /** Page size used by the API (observed: 36). */
  pageSize?: number;
  /** Safety cap to avoid infinite loops. */
  maxPages?: number;
}): Promise<string> {
  const pageSize = opts.pageSize ?? 36;
  const maxPages = opts.maxPages ?? 20;
  const cutoff = opts.maxDaysAhead != null
    ? new Date(Date.now() + opts.maxDaysAhead * 24 * 60 * 60 * 1000)
    : getScrapeCutoffDate();

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(opts.showsUrl, { waitUntil: "networkidle", timeout: 60_000 });

    const all: LiveNationVenueEvent[] = [];
    for (let i = 0; i < maxPages; i++) {
      const offset = i * pageSize;
      const apiUrl = `https://content.livenationapi.com/v1/venues/${opts.venueId}/events?offset=${offset}&limit=${pageSize}`;
      const res = await page.request.get(apiUrl);
      if (!res.ok()) {
        throw new Error(`Live Nation API HTTP ${res.status()} for ${apiUrl}`);
      }

      const batch = (await res.json()) as unknown;
      if (!Array.isArray(batch) || batch.length === 0) break;

      all.push(...(batch as LiveNationVenueEvent[]));

      const last = batch[batch.length - 1] as LiveNationVenueEvent;
      const lastStart = parseEventStart(last);
      if (lastStart && lastStart > cutoff) break;
    }

    return JSON.stringify(all);
  } finally {
    await browser.close();
  }
}
