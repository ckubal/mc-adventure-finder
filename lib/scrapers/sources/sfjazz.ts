import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml } from "../fetchHtml";

const BASE_URL = "https://www.sfjazz.org";
const HOMEPAGE_URL = `${BASE_URL}/`;

const MONTH_ABBREV: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Parse time like "8PM", "10:30PM", "1PM" to hours and minutes (24h). Default 7:30 PM. */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const t = timeStr.trim().toUpperCase().replace(/\s/g, "");
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/);
  if (!m) return { hours: 19, minutes: 30 };
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  if ((m[3] || "PM") === "PM" && hours < 12) hours += 12;
  if ((m[3] || "PM") === "AM" && hours === 12) hours = 0;
  return { hours, minutes };
}

/**
 * Parse date line like "WED, DEC 31 • 8PM & 10:30PM", "FRI, JAN 16", "WED-SUN, JAN 28-FEB 1", "SUN, DEC 21 •1PM".
 * Returns ISO string for the first date (and first time if multiple).
 */
function parseDateLine(line: string): string | null {
  const trimmed = line.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
  if (!trimmed) return null;

  const now = new Date();
  const currentYear = now.getFullYear();

  // Time part: "• 8PM & 10:30PM" or "•1PM" (optional)
  const timePart = trimmed.match(/[•&]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i);
  let hours = 19;
  let minutes = 30;
  if (timePart) {
    const parsed = parseTime(timePart[1]);
    hours = parsed.hours;
    minutes = parsed.minutes;
  }

  // "WED, DEC 31" or "DEC 31" or "FRI, JAN 16"
  const singleMatch = trimmed.match(/(?:MON|TUE|WED|THU|FRI|SAT|SUN),?\s*([A-Z]{3})\s+(\d{1,2})/i)
    || trimmed.match(/\b([A-Z]{3})\s+(\d{1,2})\b/);
  if (singleMatch) {
    const month = MONTH_ABBREV[singleMatch[1].toUpperCase()];
    if (month == null) return null;
    const day = parseInt(singleMatch[2], 10);
    if (day < 1 || day > 31) return null;
    let year = currentYear;
    const d = new Date(year, month, day, hours, minutes, 0);
    if (d < now) year = currentYear + 1;
    return new Date(year, month, day, hours, minutes, 0).toISOString();
  }

  // "WED-SUN, JAN 28-FEB 1" or "THU-FRI, DEC 18-19" -> use first day
  const rangeMatch = trimmed.match(/(?:MON|TUE|WED|THU|FRI|SAT|SUN)(?:-(?:MON|TUE|WED|THU|FRI|SAT|SUN))?,?\s*([A-Z]{3})\s+(\d{1,2})/i);
  if (rangeMatch) {
    const month = MONTH_ABBREV[rangeMatch[1].toUpperCase()];
    if (month == null) return null;
    const day = parseInt(rangeMatch[2], 10);
    if (day < 1 || day > 31) return null;
    let year = currentYear;
    const d = new Date(year, month, day, 19, 30, 0);
    if (d < now) year = currentYear + 1;
    return new Date(year, month, day, 19, 30, 0).toISOString();
  }

  // "MAY 7" or "THU, MAY 7" (no day number in month abbrev)
  const shortMatch = trimmed.match(/\b([A-Z]{3})\s+(\d{1,2})\b/);
  if (shortMatch) {
    const month = MONTH_ABBREV[shortMatch[1].toUpperCase()];
    if (month == null) return null;
    const day = parseInt(shortMatch[2], 10);
    if (day < 1 || day > 31) return null;
    let year = currentYear;
    const d = new Date(year, month, day, hours, minutes, 0);
    if (d < now) year = currentYear + 1;
    return new Date(year, month, day, hours, minutes, 0).toISOString();
  }

  return null;
}

export const sfjazzScraper: Scraper = {
  id: "sfjazz",
  name: "SFJazz",

  async fetch() {
    return fetchHtml(HOMEPAGE_URL);
  },

  parse(html: string): RawEvent[] {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(HOMEPAGE_URL);
    const seenUrls = new Set<string>();

    // Homepage: event blocks have ticket links to sfjazz.org/link/*.aspx. Find "Buy Tickets" / "Save The Date" links and their event block.
    $('a[href*="sfjazz.org/link/"][href*=".aspx"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href");
      const linkText = $a.text().trim().toLowerCase();
      // Only event ticket links; skip Join, More, INFO, View Archive, Inquire, etc.
      if (!href || seenUrls.has(href)) return;
      if (!linkText.includes("buy tickets") && !linkText.includes("save the date")) return;

      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      if (!fullUrl.includes("sfjazz.org")) return;
      seenUrls.add(fullUrl);

      // Find the event block: walk up to a container that has a heading or date-like text
      let $block = $a.closest("section, article, [class*='event'], [class*='card'], [class*='slide']").first();
      if (!$block.length) $block = $a.parent();
      for (let i = 0; i < 5 && $block.length; i++) {
        const text = $block.text();
        if (text.length > 100 && (/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{1,2}\b/.test(text) || /\b(MON|TUE|WED|THU|FRI|SAT|SUN)[,\s]/.test(text)))
          break;
        $block = $block.parent();
      }
      const blockHtml = $block.length ? $block : $a.parent();

      // Date: look for h6 or text that looks like "WED, DEC 31 • 8PM"
      let dateLine = blockHtml.find("h6").first().text().trim();
      if (!dateLine) {
        const text = blockHtml.text();
        const dateLike = text.match(/(?:MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z\s,\-•&\d:APM]+/);
        if (dateLike) dateLine = dateLike[0].trim();
      }
      const startAt = dateLine ? parseDateLine(dateLine) : null;
      if (!startAt) return;

      // Title: h3, h4, h2, or image alt (SFJazz often uses img alt for artist name)
      let title =
        blockHtml.find("h3").first().text().trim() ||
        blockHtml.find("h4").first().text().trim() ||
        blockHtml.find("h2").first().text().trim() ||
        blockHtml.find("img[alt]").first().attr("alt")?.trim() ||
        blockHtml.find("[class*='title'], [class*='name']").first().text().trim();
      if (!title || title.length < 2) return;

      title = title.replace(/\s+/g, " ").trim();

      // Description: first substantial paragraph (skip "Buy Tickets" etc.)
      let description: string | null = blockHtml.find("p").first().text().trim() || null;
      if (description && (description.length < 15 || description.toLowerCase().includes("buy tickets")))
        description = null;

      // Venue: often SFJazz Center; sometimes Davies Symphony Hall
      let locationName = "SFJazz Center";
      const blockText = blockHtml.text();
      if (blockText.includes("Davies Symphony Hall")) locationName = "Davies Symphony Hall";

      events.push({
        title,
        startAt,
        sourceUrl: fullUrl,
        description,
        locationName,
        tags: ["jazz", "music"],
      });
    });

    return events;
  },
};
