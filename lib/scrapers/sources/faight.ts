import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml } from "../fetchHtml";
import { parseIsoAssumingTimeZone } from "../timezone";

const EVENTS_URL = "https://www.thefaight.com/events";

const DETAIL_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;

/**
 * The Faight sells tickets through Eventbrite; its events page embeds Eventbrite
 * event links (inside a JS/JSON blob, so they arrive HTML/unicode-escaped). We pull
 * those links out and read each Eventbrite page's meta tags, which carry a clean
 * title and an exact start time.
 */
function extractEventbriteUrls(html: string): string[] {
  const byId = new Map<string, string>();
  // Match even when embedded in escaped JSON (& for &, trailing backslashes).
  const re = /https?:\/\/(?:www\.)?eventbrite\.[a-z.]+\/e\/[a-z0-9-]+-tickets-(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    // Canonical URL without query string so each event is fetched once.
    if (!byId.has(id)) byId.set(id, m[0]);
  }
  return [...byId.values()];
}

function cleanFaightTitle(raw: string): string {
  return cheerio
    .load(`<div>${raw}</div>`)
    .text()
    // Drop the venue tag Eventbrite titles carry. First remove any mid-title
    // "@/at The Faight" (keeps a trailing "(Night One)"), then any trailing
    // separator-led tag like "… | The Faight".
    .replace(/\s*(?:live\s+)?(?:@|at)\s+the faight/gi, " ")
    .replace(/\s*[|\-–—]\s*(?:live\s+)?the faight.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchDetail(url: string): Promise<RawEvent | null> {
  try {
    const html = await fetchHtml(url, DETAIL_FETCH_TIMEOUT_MS);
    const $ = cheerio.load(html);

    const startRaw =
      $('meta[property="event:start_time"]').attr("content") ||
      $('meta[name="event:start_time"]').attr("content") ||
      null;
    const startAt = startRaw ? parseIsoAssumingTimeZone(startRaw) : null;
    if (!startAt) return null; // no reliable date → skip rather than guess

    const endRaw = $('meta[property="event:end_time"]').attr("content") || null;
    const endAt = endRaw ? parseIsoAssumingTimeZone(endRaw) : null;

    const ogTitle =
      $('meta[property="og:title"]').attr("content") || $("title").first().text() || "";
    const title = cleanFaightTitle(ogTitle);
    if (!title || title.length < 2) return null;

    const desc = $('meta[property="og:description"]').attr("content") || null;
    const description = desc ? desc.replace(/\s+/g, " ").trim() : null;

    return {
      title,
      startAt,
      endAt,
      sourceUrl: url,
      locationName: "The Faight",
      locationAddress: "255 Fillmore St, San Francisco, CA",
      description,
      tags: ["concert"],
    };
  } catch {
    return null;
  }
}

export const faightScraper: Scraper = {
  id: "faight",
  name: "The Faight",

  async fetch() {
    return fetchHtml(EVENTS_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const urls = extractEventbriteUrls(html);
    const events: RawEvent[] = [];
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const chunk = urls.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(fetchDetail));
      for (const r of results) if (r) events.push(r);
    }
    return events;
  },
};
