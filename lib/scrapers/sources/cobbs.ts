import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { titleFromJsonLdEvent, startDateFromJsonLdEvent } from "../jsonLdEvent";
import type { LiveNationVenueEvent } from "../liveNationVenue";
import { fetchLiveNationVenueEventsJson } from "../liveNationVenue";

const BASE_URL = "https://www.cobbscomedy.com";
const SHOWS_URL = `${BASE_URL}/shows`;
const LIVE_NATION_VENUE_ID = "KovZpZAEkFEA";

function parseDate(dateStr: string, timeStr: string): string {
  const trimmed = dateStr.trim();
  const timeTrimmed = timeStr.trim().toLowerCase();
  if (!trimmed) return "";
  const slashMatch = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const wordMatch = trimmed.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  let month: number;
  let day: number;
  let year: number;
  if (slashMatch) {
    month = parseInt(slashMatch[1], 10) - 1;
    day = parseInt(slashMatch[2], 10);
    year = parseInt(slashMatch[3], 10);
  } else if (wordMatch) {
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    month = months[wordMatch[1].slice(0, 3)] ?? 0;
    day = parseInt(wordMatch[2], 10);
    year = parseInt(wordMatch[3], 10);
  } else {
    return "";
  }
  if (!year || !day) return "";
  let hours = 19;
  let minutes = 0;
  if (timeTrimmed && timeTrimmed !== "all day") {
    const m = timeTrimmed.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (m) {
      hours = parseInt(m[1], 10);
      minutes = m[2] ? parseInt(m[2], 10) : 0;
      if (m[3] === "pm" && hours < 12) hours += 12;
      if (m[3] === "am" && hours === 12) hours = 0;
    }
  }
  return new Date(year, month, day, hours, minutes, 0).toISOString();
}

function parseStartDate(iso: string): string | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function addressFromVenue(ev: LiveNationVenueEvent): string | null {
  const loc = ev.venue?.location;
  if (!loc) return null;
  const parts = [
    loc.street_address,
    [loc.locality, loc.region].filter(Boolean).join(", "),
    loc.postal_code,
  ]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function parseLiveNationEventsJson(jsonText: string): RawEvent[] | null {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    const first = parsed[0] as Record<string, unknown>;
    if (first == null || typeof first !== "object") return null;
    if (!("datetime_local" in first) && !("start_datetime_utc" in first)) return null;

    const events: RawEvent[] = [];
    const seen = new Set<string>();

    for (const item of parsed as LiveNationVenueEvent[]) {
      const title = typeof item.name === "string" ? item.name.trim() : "";
      if (title.length < 2) continue;

      const dt = (typeof item.datetime_local === "string" && item.datetime_local) ||
        (typeof item.start_datetime_utc === "string" && item.start_datetime_utc) ||
        null;
      if (!dt) continue;
      const d = new Date(dt);
      if (Number.isNaN(d.getTime())) continue;
      const startAt = d.toISOString();

      const sourceUrl = typeof item.url === "string" && item.url.startsWith("http")
        ? item.url
        : SHOWS_URL;

      const sourceEventId =
        (typeof item.tm_id === "string" && item.tm_id) ||
        (typeof item.discovery_id === "string" && item.discovery_id) ||
        (typeof item.id === "string" && item.id) ||
        undefined;

      const dedupeKey = sourceEventId ?? `${title}|${startAt}|${sourceUrl}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const description =
        typeof item.important_info === "string" && item.important_info.trim().length > 0
          ? item.important_info.trim()
          : null;

      events.push({
        title,
        startAt,
        sourceUrl,
        sourceEventId,
        locationName: "Cobb's Comedy Club",
        locationAddress: addressFromVenue(item),
        description,
        tags: ["comedy"],
        raw: {
          provider: "livenation",
          venueId: LIVE_NATION_VENUE_ID,
          tm_id: item.tm_id,
          discovery_id: item.discovery_id,
        },
      });
    }

    return events;
  } catch {
    return null;
  }
}

export const cobbsScraper: Scraper = {
  id: "cobbs",
  name: "Cobb's Comedy",

  async fetch() {
    // Live Nation sites only render ~one page of JSON-LD; additional events load via API on scroll.
    // Fetch the venue API (via Playwright session) so we can grab months of events.
    return fetchLiveNationVenueEventsJson({
      venueId: LIVE_NATION_VENUE_ID,
      showsUrl: SHOWS_URL,
    });
  },

  parse(html: string): RawEvent[] {
    const maybeJson = html.trim();
    if (maybeJson.startsWith("[")) {
      const ln = parseLiveNationEventsJson(maybeJson);
      if (ln) return ln;
    }

    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(SHOWS_URL);

    // Try JSON-LD first (common on Live Nation sites)
    const scriptTags = $('script[type="application/ld+json"]');
    const seenUrls = new Set<string>();
    
    scriptTags.each((_, el) => {
      try {
        const jsonText = $(el).html();
        if (!jsonText) return;
        const data = JSON.parse(jsonText);
        const items = Array.isArray(data) ? data : data["@graph"] || [data];
        
        for (const item of items) {
          if (item["@type"] === "Event" || item["@type"] === "MusicEvent" || item["@type"] === "ComedyEvent") {
            const url = item.url || item["@id"];
            if (!url || seenUrls.has(url)) continue;
            seenUrls.add(url);
            
            const title = item.name || titleFromJsonLdEvent(item);
            if (!title || title.length < 2) continue;
            
            const startDate = item.startDate || startDateFromJsonLdEvent(item);
            if (!startDate) continue;
            
            const startAt = parseStartDate(startDate);
            if (!startAt) continue;
            
            // Extract description from JSON-LD
            let description: string | null = null;
            if (item.description && typeof item.description === "string") {
              const desc = item.description.replace(/<[^>]+>/g, "").trim();
              if (desc.length > 0) description = desc;
            }
            
            events.push({
              title: String(title),
              startAt,
              sourceUrl: url.startsWith("http") ? url : new URL(url, base).href,
              locationName: "Cobb's Comedy Club",
              description,
              tags: ["comedy"],
            });
          }
        }
      } catch {
        // Skip invalid JSON
      }
    });

    // Fallback: look for event links in the DOM
    if (events.length === 0) {
      $("a[href*='/shows/'], a[href*='event']").each((_, el) => {
        const $a = $(el);
        const href = $a.attr("href");
        if (!href || seenUrls.has(href)) return;
        seenUrls.add(href);
        
        const title = $a.find("h2, h3, .title, [data-testid*='title']").first().text().trim() || 
                     $a.text().trim().split("\n")[0]?.trim();
        if (!title || title.length < 2) return;

        const $card = $a.closest("article, [class*='event'], [class*='show'], [data-testid*='event']").length
          ? $a.closest("article, [class*='event'], [class*='show'], [data-testid*='event']")
          : $a.parent();
        const text = $card.text();
        const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})|([A-Za-z]+\s+\d{1,2},?\s*\d{4})/);
        if (!dateMatch) return;
        const dateStr = dateMatch[0].trim();
        const timeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
        const timeStr = timeMatch ? timeMatch[0].trim() : "7:00pm";
        const startAt = parseDate(dateStr, timeStr);
        if (!startAt) return;

        const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
        events.push({
          title,
          startAt,
          sourceUrl: fullUrl,
          locationName: "Cobb's Comedy Club",
          tags: ["comedy"],
        });
      });
    }

    return events;
  },
};
