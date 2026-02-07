import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import { extractJsonLdEvent } from "../jsonLdEvent";

const BASE_URL = "https://rickshawstop.com";
const CALENDAR_URL = `${BASE_URL}/calendar/`;

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
  let hours = 20;
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

const DETAIL_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 5;

const MAX_CALENDAR_PAGES = 5;

export const rickshawScraper: Scraper = {
  id: "rickshaw",
  name: "Rickshaw Stop",

  async fetch() {
    return fetchHtml(CALENDAR_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const base = new URL(CALENDAR_URL);
    const allHtml: string[] = [html];
    const events: RawEvent[] = [];

    // Fetch additional calendar pages (Rickshaw uses ?list1page=N)
    for (let page = 2; page <= MAX_CALENDAR_PAGES; page++) {
      try {
        const pageUrl = `${CALENDAR_URL}?list1page=${page}`;
        const nextHtml = await fetchHtml(pageUrl);
        const $p = cheerio.load(nextHtml);
        if ($p(".seetickets-list-event-container").length === 0) break;
        allHtml.push(nextHtml);
      } catch {
        break;
      }
    }

    for (const pageHtml of allHtml) {
      const $ = cheerio.load(pageHtml);

    // Rickshaw Stop uses .seetickets-list-event-container for each event.
    $(".seetickets-list-event-container").each((_, el) => {
      const $container = $(el);
      
      // Title is in .title > a
      const $titleLink = $container.find(".title a").first();
      const title = $titleLink.text().trim();
      if (!title || title.length < 2) return;
      
      // Event link (wl.seetickets.us)
      const href = $titleLink.attr("href");
      if (!href || !href.includes("seetickets.us/event/")) return;
      
      // Date is in .date (e.g. "Thu Feb 5")
      const dateText = $container.find(".date").first().text().trim();
      if (!dateText) return;
      
      // Parse "Thu Feb 5" format
      const dateMatch = dateText.match(/([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})/);
      if (!dateMatch) return;
      
      const months: Record<string, number> = {
        Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
        Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
      };
      const month = months[dateMatch[2].slice(0, 3)];
      if (!month) return;
      const day = parseInt(dateMatch[3], 10);
      if (!day || day < 1 || day > 31) return;
      
      // Assume current year, adjust if date has passed
      const now = new Date();
      let year = now.getFullYear();
      const eventDate = new Date(year, month - 1, day);
      if (eventDate < now) year += 1;
      
      // Show time is in .doortime-showtime > .see-showtime (e.g. "8:00PM")
      const showTimeText = $container.find(".see-showtime").first().text().trim();
      let hours = 20;
      let minutes = 0;
      if (showTimeText) {
        const timeMatch = showTimeText.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);
        if (timeMatch) {
          hours = parseInt(timeMatch[1], 10);
          minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
          if (timeMatch[3].toLowerCase() === "pm" && hours < 12) hours += 12;
          if (timeMatch[3].toLowerCase() === "am" && hours === 12) hours = 0;
        }
      }
      
      const startAt = new Date(year, month - 1, day, hours, minutes, 0).toISOString();
      
      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      events.push({
        title,
        startAt,
        sourceUrl: fullUrl,
        locationName: "Rickshaw Stop",
        tags: ["concert"],
      });
    });
    }

    // Dedupe by sourceUrl (same event might appear on multiple pages)
    const seen = new Set<string>();
    const uniqueEvents = events.filter((e) => {
      if (seen.has(e.sourceUrl)) return false;
      seen.add(e.sourceUrl);
      return true;
    });

    // Enrich with descriptions from detail pages
    const enrichedEvents: RawEvent[] = [];
    for (let i = 0; i < uniqueEvents.length; i += CONCURRENCY) {
      const chunk = uniqueEvents.slice(i, i + CONCURRENCY);
      const enriched = await Promise.all(
        chunk.map(async (event) => {
          try {
            const { html: detailHtml } = await fetchHtmlWithUrl(event.sourceUrl, DETAIL_FETCH_TIMEOUT_MS);
            const ld = extractJsonLdEvent(detailHtml);
            let description: string | null = null;
            if (ld?.description && typeof ld.description === "string") {
              const desc = ld.description.replace(/<[^>]+>/g, "").trim();
              if (desc.length > 0) description = desc;
            } else {
              const $ = cheerio.load(detailHtml);
              const metaDesc = $('meta[name="description"], meta[property="og:description"]').attr("content");
              if (metaDesc && metaDesc.length > 20) {
                description = metaDesc.trim();
              }
            }
            return { ...event, description };
          } catch {
            return event;
          }
        })
      );
      enrichedEvents.push(...enriched);
    }
    return enrichedEvents;
  },
};
