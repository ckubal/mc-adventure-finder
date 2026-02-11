import type { Scraper, RawEvent } from "../types";
import { fetchTicketmasterArtistEvents } from "../ticketmasterArtistEvents";

const ARTIST_ID = "805946";
const ARTIST_URL = "https://www.ticketmaster.com/golden-state-warriors-tickets/artist/805946";

export const warriorsScraper: Scraper = {
  id: "warriors",
  name: "Golden State Warriors (Home)",

  async fetch() {
    const events = await fetchTicketmasterArtistEvents({
      artistId: ARTIST_ID,
      warmUrl: ARTIST_URL,
      // Ticketmaster "artist" schedule for Warriors is already Chase Center home games.
      // Still apply scrape window cutoff in helper.
      maxPages: 5,
      include: (ev) => {
        const venue = ev.venue?.name?.toLowerCase() ?? "";
        // Guard: keep only Chase Center games in San Francisco.
        if (venue && !venue.includes("chase center")) return false;
        if ((ev.venue?.city ?? "").toLowerCase() !== "san francisco") return false;
        return true;
      },
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
      const title = String(ev?.title ?? "").trim();
      const startRaw = String(ev?.dates?.startDate ?? "").trim();
      const url = String(ev?.url ?? "").trim() || sourceUrl;
      if (!title || !startRaw || !url) continue;

      const locationName = ev?.venue?.name ? String(ev.venue.name).trim() : "Chase Center";
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
        tags: ["sports", "basketball"],
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

