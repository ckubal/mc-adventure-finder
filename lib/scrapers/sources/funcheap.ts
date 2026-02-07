import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml } from "../fetchHtml";

const CALENDAR_URL = "https://sf.funcheap.com/events/san-francisco/";

/** Parse "Wednesday, February 4, 2026" style date string to YYYY-MM-DD for combining with time. */
function parseDayHeader(text: string): { year: number; month: number; day: number } | null {
  const m = text.trim().match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*(\w+)\s+(\d{1,2}),?\s*(\d{4})$/i);
  if (!m) return null;
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const month = months[m[1].toLowerCase().trim()];
  if (month == null) return null;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (!year || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Parse "6:00 pm" or "11:00 am" to hours and minutes (24h). */
function parseTime(text: string): { hours: number; minutes: number } {
  const t = text.trim().toLowerCase();
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return { hours: 19, minutes: 0 };
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "pm" && hours < 12) hours += 12;
  if (m[3] === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

function toISO(year: number, month: number, day: number, hours: number, minutes: number): string {
  return new Date(year, month, day, hours, minutes, 0).toISOString();
}

type CheerioAPI = ReturnType<typeof cheerio.load>;
type CheerioEl = ReturnType<CheerioAPI>;

/** Extract venue/location from a row or container. Tries multiple patterns used on Funcheap. */
function extractVenue($: CheerioAPI, $container: CheerioEl): string | null {
  const html = $container.html() ?? "";
  const text = $container.text();

  // 1. "| <span>Venue Name</span>" (current pattern)
  let m = html.match(/\|\s*<span>([^<]+)<\/span>/);
  if (m?.[1]) return m[1].trim();

  // 2. Pipe + any text (with or without tags after): "| Venue Name" or "| Venue</a>"
  m = html.match(/\|\s*([^|<]+?)(?:\s*<|\s*$)/);
  if (m?.[1]) {
    const v = m[1].trim();
    if (v.length > 1 && v.length < 80 && !/^\d{1,2}:\d{2}\s*[ap]m$/i.test(v)) return v;
  }

  // 3. Plain text: " | Venue Name" or " at Venue Name" or " @ Venue Name"
  m = text.match(/\s[\|@]\s*([^|\n]+?)(?:\s*\||\s*FREE|$)/i);
  if (m?.[1]) {
    const v = m[1].trim();
    if (v.length > 1 && v.length < 80 && !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(v)) return v;
  }
  m = text.match(/\s+at\s+([^|\n]+?)(?:\s*\||\s*FREE|$)/i);
  if (m?.[1]) {
    const v = m[1].trim();
    if (v.length > 1 && v.length < 80) return v;
  }

  // 4. Elements with venue/location class
  const $venue = $container.find(".venue, .location, [class*='venue'], [class*='location']").first();
  if ($venue.length) {
    const v = $venue.text().trim();
    if (v.length > 1 && v.length < 80) return v;
  }

  // 5. Td that looks like a venue (short, not time, not day name) - e.g. second or third column
  const tds: string[] = [];
  $container.find("td").each((_, td) => {
    const t = $(td).text().trim();
    if (t.length >= 2 && t.length <= 60 && !/^\d{1,2}(?::\d{2})?\s*[ap]m$/i.test(t) && !/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(t)) {
      tds.push(t);
    }
  });
  if (tds.length >= 2) {
    const candidate = tds[tds.length - 1];
    if (candidate && candidate.length < 50) return candidate;
  }

  return null;
}

export const funcheapScraper: Scraper = {
  id: "funcheap",
  name: "Funcheap SF",

  async fetch() {
    return fetchHtml(CALENDAR_URL);
  },

  parse(html: string): RawEvent[] {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(CALENDAR_URL);

    let currentDay: { year: number; month: number; day: number } | null = null;
    const seenUrls = new Set<string>();

    // Walk table rows in order: date headers set currentDay; event rows use it.
    $("table tr").each((_, trEl) => {
      const $tr = $(trEl);
      const h2 = $tr.find("h2").first();
      if (h2.length) {
        const parsed = parseDayHeader(h2.text());
        if (parsed) currentDay = parsed;
        return;
      }

      const firstTd = $tr.find("td").first();
      const timeText = firstTd.text().trim();
      const $link = $tr.find(".entry-title a[rel='bookmark']").first();
      if (!$link.length || !currentDay) return;

      const href = $link.attr("href");
      let title = ($link.attr("title") || $link.text()).trim();
      if (!href) return;
      if (!title) title = href.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? "Event";

      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      if (seenUrls.has(fullUrl)) return;
      seenUrls.add(fullUrl);

      const { hours, minutes } = parseTime(timeText);
      const startAt = toISO(currentDay.year, currentDay.month, currentDay.day, hours, minutes);

      // Extract description: look for text after the link, or tooltip content
      let description = $tr.find(".tooltip .middle").first().text().trim() || null;
      if (!description) {
        const $nextTd = $tr.find("td").eq(1);
        const textAfterLink = $nextTd.clone().children().remove().end().text().trim();
        if (textAfterLink && textAfterLink.length > 10) {
          description = textAfterLink;
        }
      }

      // Location: extract venue from row (or previous row for featured layout)
      let locationName = extractVenue($, $tr);
      if (!locationName) {
        const $prev = $tr.prevAll("tr").first();
        if ($prev.length) locationName = extractVenue($, $prev);
      }

      events.push({
        title,
        startAt,
        sourceUrl: fullUrl,
        description,
        locationName,
        tags: [],
      });
    });

    // Featured events: div.entry-title with link inside a td (after an h2 in same table). Re-scan with date context.
    currentDay = null;
    $("table tr").each((_, trEl) => {
      const $tr = $(trEl);
      const h2 = $tr.find("h2").first();
      if (h2.length) {
        const parsed = parseDayHeader(h2.text());
        if (parsed) currentDay = parsed;
      }
      if (!currentDay) return;
      $tr.find("td div.entry-title a[rel='bookmark']").each((__, aEl) => {
        const $a = $(aEl);
        const href = $a.attr("href");
        let title = ($a.attr("title") || $a.text()).trim();
        if (!href) return;
        if (!title) title = href.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? "Event";
        const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
        if (seenUrls.has(fullUrl)) return;
        seenUrls.add(fullUrl);

        // Extract description for featured events: look for text after title or in meta
        const $parent = $a.closest("td, div");
        let description = $parent.find(".tooltip .middle").first().text().trim() || null;
        if (!description) {
          const textAfter = $parent.clone().children("a, img").remove().end().text().trim();
          if (textAfter && textAfter.length > 10 && !textAfter.match(/^(FREE|Cost:|Wednesday|Thursday|Friday|Saturday|Sunday)/i)) {
            description = textAfter.slice(0, 300);
          }
        }

        // Location: extract venue from same block
        const locationName = extractVenue($, $parent);

        events.push({
          title,
          startAt: toISO(currentDay!.year, currentDay!.month, currentDay!.day, 19, 0),
          sourceUrl: fullUrl,
          description,
          locationName,
          tags: [],
        });
      });
    });

    return events;
  },
};
