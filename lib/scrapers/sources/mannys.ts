import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Scraper, RawEvent } from "../types";
import { fetchWithPlaywrightAutoScroll } from "../fetchPlaywright";

const BASE_URL = "https://www.eventbrite.com";
const EVENTS_URL = `${BASE_URL}/o/mannys-15114280512`;
// Target at least 30 days of upcoming events; we fetch a bit further to be safe.
const TARGET_DAYS_AHEAD = 60;

function parseStartDate(iso: string): string | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

type CheerioAPI = ReturnType<typeof cheerio.load>;

function parseEventbriteCardDateTime(text: string, now = new Date()): string | null {
  // Example: "Mon, Mar 2 • 7:00 PM + 9 more"
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(
    /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+([A-Za-z]{3,})\s+(\d{1,2})\s*[•·]\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)/i
  );
  if (!m) {
    // Fallback for some recurring cards that omit month/day:
    // "Saturday • 10:30 AM + 10 more"
    const wd = cleaned.match(
      /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b\s*[•·]\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)/i
    );
    if (!wd) return null;
    const weekdayName = wd[1].toLowerCase().slice(0, 3);
    const weekdayIdx: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const target = weekdayIdx[weekdayName];
    if (target == null) return null;
    let hours = parseInt(wd[2], 10);
    const minutes = wd[3] ? parseInt(wd[3], 10) : 0;
    const ampm = wd[4].toLowerCase();
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;

    // Find the next occurrence of the weekday (including today if still upcoming).
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setHours(hours, minutes, 0, 0);
    const dow = candidate.getDay();
    let add = (target - dow + 7) % 7;
    if (add === 0 && candidate <= now) add = 7;
    candidate.setDate(candidate.getDate() + add);
    if (Number.isNaN(candidate.getTime())) return null;
    return candidate.toISOString();
  }

  const monthName = m[2].toLowerCase().slice(0, 3);
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[monthName];
  if (month == null) return null;
  const day = parseInt(m[3], 10);
  let hours = parseInt(m[4], 10);
  const minutes = m[5] ? parseInt(m[5], 10) : 0;
  const ampm = m[6].toLowerCase();
  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  let year = now.getFullYear();
  let d = new Date(year, month, day, hours, minutes, 0);
  // If this date is far in the past, assume it's next year (year rollover).
  if (d.getTime() < now.getTime() - 2 * 86_400_000) {
    year += 1;
    d = new Date(year, month, day, hours, minutes, 0);
  }
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeEventbriteEventUrl(url: string): string {
  try {
    const u = new URL(url);
    // Drop query params like ?aff=... so we can dedupe reliably.
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

function eventIdFromEventbriteUrl(url: string): string | null {
  const m = url.match(/tickets-(\d+)/);
  if (m?.[1]) return m[1];
  // Fallback: some Eventbrite URLs may use eid query param.
  try {
    const u = new URL(url);
    const eid = u.searchParams.get("eid");
    if (eid) return eid;
  } catch {
    // ignore
  }
  return null;
}

function nearestAncestorWithDateTime(
  $: CheerioAPI,
  $a: cheerio.Cheerio<AnyNode>,
  eventId: string | null
): cheerio.Cheerio<AnyNode> | null {
  // Walk up a few levels until we find a container whose text includes a recognizable
  // "Mon, Mar 2 • 7:00 PM" pattern.
  let $node: cheerio.Cheerio<AnyNode> = $a.parent() as unknown as cheerio.Cheerio<AnyNode>;
  for (let i = 0; i < 10; i++) {
    if (!$node || !$node.length) break;
    const text = $node.text().replace(/\s+/g, " ").trim();
    if (/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+[A-Za-z]{3,}\s+\d{1,2}\s*[•·]\s*\d{1,2}(?::\d{2})?\s*[AP]M/i.test(text)) {
      if (!eventId) return $node;

      // Ensure this container corresponds to a single event card (avoid list wrappers that
      // contain multiple different event links).
      const ids = new Set<string>();
      $node.find("a[href*='eventbrite.com/e/'], a[href*='/e/']").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        const fullHref = href.startsWith("http") ? href : href.startsWith("/") ? `https://www.eventbrite.com${href}` : href;
        const id = eventIdFromEventbriteUrl(fullHref);
        if (id) ids.add(id);
      });
      if (ids.size <= 1) return $node;
    }
    $node = $node.parent() as unknown as cheerio.Cheerio<AnyNode>;
  }
  return null;
}

export const mannysScraper: Scraper = {
  id: "mannys",
  name: "Manny's",

  async fetch() {
    // Eventbrite organizer pages load additional upcoming events on scroll.
    return fetchWithPlaywrightAutoScroll(EVENTS_URL, {
      clickUpcomingTab: true,
      stabilizeSelector: "a[href*='/e/']",
      maxScrolls: 12,
      timeoutMs: 60_000,
    });
  },

  parse(html: string): RawEvent[] {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(EVENTS_URL);
    const now = new Date();
    const cutoff = new Date(now.getTime() + TARGET_DAYS_AHEAD * 24 * 60 * 60 * 1000);

    // Eventbrite uses JSON-LD for events - look for all JSON-LD scripts
    const scriptTags = $('script[type="application/ld+json"]');
    const seenUrls = new Set<string>();
    
    scriptTags.each((_, el) => {
      try {
        const jsonText = $(el).html();
        if (!jsonText) return;
        const data = JSON.parse(jsonText);
        
        // Handle different JSON-LD structures
        let items: unknown[] = [];
        if (Array.isArray(data)) {
          items = data;
        } else if (data["@graph"] && Array.isArray(data["@graph"])) {
          items = data["@graph"];
        } else if (data["@type"] === "Event" || data["@type"] === "ItemList") {
          items = [data];
          // If it's an ItemList, extract the itemListElement
          if (data["@type"] === "ItemList" && Array.isArray(data.itemListElement)) {
            items = data.itemListElement.map((el: unknown) => {
              if (typeof el === "object" && el !== null && "item" in el) {
                return el.item;
              }
              return el;
            });
          }
        }
        
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const obj = item as Record<string, unknown>;
          
          if (obj["@type"] === "Event" || (obj.name && obj.startDate)) {
            const url = (obj.url || obj["@id"] || obj.id) as string | undefined;
            if (!url || !url.includes("eventbrite.com")) continue;
            const normUrl = normalizeEventbriteEventUrl(url);
            if (seenUrls.has(normUrl)) continue;
            
            const title = obj.name as string | undefined;
            if (!title || typeof title !== "string" || title.length < 2) continue;
            
            const startDate = obj.startDate as string | undefined;
            if (!startDate) continue;
            
            const startAt = parseStartDate(startDate);
            if (!startAt) continue;
            const startDateObj = new Date(startAt);
            if (Number.isNaN(startDateObj.getTime())) continue;
            // Prefer upcoming events within the target horizon for this source.
            if (startDateObj < now || startDateObj > cutoff) continue;
            seenUrls.add(normUrl);
            
            // Extract description from JSON-LD
            let description: string | null = null;
            if (obj.description && typeof obj.description === "string") {
              const desc = obj.description.replace(/<[^>]+>/g, "").trim();
              if (desc.length > 0) description = desc;
            }
            
            events.push({
              title,
              startAt,
              sourceUrl: normUrl.startsWith("http") ? normUrl : new URL(normUrl, base).href,
              locationName: "Manny's",
              description,
              tags: ["talk", "community"],
            });
          }
        }
      } catch {
        // Skip invalid JSON
      }
    });

    // Also scan DOM event cards (Eventbrite loads more on scroll; JSON-LD can be partial).
    $("a[href*='/e/'], a[href*='eventbrite.com/e/']").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href");
      if (!href) return;
      const fullHref = href.startsWith("http") ? href : new URL(href, base).href;
      if (!fullHref.includes("eventbrite.com/e/")) return;
      const normHref = normalizeEventbriteEventUrl(fullHref);
      if (seenUrls.has(normHref)) return;
      const eventId = eventIdFromEventbriteUrl(fullHref);

      // Eventbrite markup varies between server HTML and hydrated DOM. Walk ancestors
      // to find a container with the date/time string.
      const $container = nearestAncestorWithDateTime($, $a, eventId);
      if (!$container) return;
      const containerText = $container.text().replace(/\s+/g, " ").trim();
      const startAt = parseEventbriteCardDateTime(containerText, now);
      if (!startAt) return;
      const d = new Date(startAt);
      if (d < now || d > cutoff) return;

      let title =
        $container.find("h3, h2").first().text().replace(/\s+/g, " ").trim() ||
        ($a.attr("aria-label") ?? $a.attr("title") ?? "").trim() ||
        $a.text().replace(/\s+/g, " ").trim();
      if (!title) {
        const idx = containerText.search(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+[A-Za-z]{3,}\s+\d{1,2}\s*[•·]\s*\d{1,2}/i);
        if (idx > 0) title = containerText.slice(0, idx).trim();
      }
      if (!title || title.length < 2) return;

      const fullUrl = normHref.startsWith("http") ? normHref : new URL(normHref, base).href;
      seenUrls.add(normHref);
      events.push({
        title,
        startAt,
        sourceUrl: fullUrl,
        locationName: "Manny's",
        tags: ["talk", "community"],
      });
    });

    return events;
  },
};
