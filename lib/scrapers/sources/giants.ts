import type { Scraper, RawEvent } from "../types";
import { fetchTicketmasterArtistEvents } from "../ticketmasterArtistEvents";

const ARTIST_ID = "806016";
const ARTIST_URL =
  "https://www.ticketmaster.com/san-francisco-giants-tickets/artist/806016?home_away=home";

function isOraclePark(ev: { venue?: { name?: string; city?: string; state?: string } } | null | undefined): boolean {
  const name = (ev?.venue?.name ?? "").toLowerCase();
  const city = (ev?.venue?.city ?? "").toLowerCase();
  const state = (ev?.venue?.state ?? "").toLowerCase();
  return name.includes("oracle park") && city === "san francisco" && (state === "ca" || state === "");
}

export const giantsScraper: Scraper = {
  id: "giants",
  name: "SF Giants (Oracle Park)",

  async fetch() {
    const events = await fetchTicketmasterArtistEvents({
      artistId: ARTIST_ID,
      query: { home_away: "home" },
      // Giants have many pages; stop once beyond SCRAPE_WINDOW_DAYS.
      maxPages: 25,
      include: (ev) => isOraclePark(ev),
    });
    return JSON.stringify({ sourceUrl: ARTIST_URL, events });
  },

  parse(jsonText: string): RawEvent[] {
    let payload: { sourceUrl: string; events: unknown } | null = null;
    try {
      payload = JSON.parse(jsonText) as { sourceUrl: string; events: unknown };
    } catch {
      return [];
    }
    const sourceUrl = payload?.sourceUrl || ARTIST_URL;
    const list = Array.isArray(payload?.events) ? payload.events : [];

    const out: RawEvent[] = [];
    for (const item of list) {
      const ev = item as any;
      if (!isOraclePark(ev)) continue;

      const title = String(ev?.title ?? "").trim();
      const startRaw = String(ev?.dates?.startDate ?? "").trim();
      const url = String(ev?.url ?? "").trim() || sourceUrl;
      if (!title || !startRaw || !url) continue;

      const locationName = ev?.venue?.name ? String(ev.venue.name).trim() : "Oracle Park";
      const city = ev?.venue?.city ? String(ev.venue.city).trim() : "San Francisco";
      const state = ev?.venue?.state ? String(ev.venue.state).trim() : "CA";
      const address = ev?.venue?.addressLineOne ? String(ev.venue.addressLineOne).trim() : "";
      const locationAddress = [address, city, state].filter(Boolean).join(", ") || null;

      out.push({
        title,
        startAt: new Date(startRaw).toISOString(),
        sourceUrl: url,
        sourceEventId: String(ev?.id ?? ev?.discoveryId ?? url),
        locationName,
        locationAddress,
        tags: ["sports", "baseball"],
        raw: {
          ticketmasterId: ev?.id ?? null,
          discoveryId: ev?.discoveryId ?? null,
          timeZone: ev?.timeZone ?? null,
        },
      });
    }
    return out;
  },
};

