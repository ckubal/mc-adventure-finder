import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import { extractJsonLdEvent } from "../jsonLdEvent";
import { isoFromZonedParts } from "../timezone";

const BASE_URL = "https://grayarea.org";
const EVENTS_URL = `${BASE_URL}/visit/events/`;

function parseDateFromText(text: string): string | null {
  // e.g. "02/05" or "Feb 5" or "02/05/2026"
  const isoMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (isoMatch) {
    const [, month, day, year] = isoMatch;
    return isoFromZonedParts({
      year: parseInt(year, 10),
      month: parseInt(month, 10),
      day: parseInt(day, 10),
      hour: 19,
      minute: 0,
      second: 0,
    });
  }
  const shortMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (shortMatch) {
    const [, month, day] = shortMatch;
    const now = new Date();
    const year = now.getFullYear();
    let y = year;
    let candidate = new Date(isoFromZonedParts({
      year: y,
      month: parseInt(month, 10),
      day: parseInt(day, 10),
      hour: 19,
      minute: 0,
      second: 0,
    }));
    if (candidate < now) {
      y = year + 1;
      candidate = new Date(isoFromZonedParts({
        year: y,
        month: parseInt(month, 10),
        day: parseInt(day, 10),
        hour: 19,
        minute: 0,
        second: 0,
      }));
    }
    return candidate.toISOString();
  }
  const monthMatch = text.match(/([A-Za-z]{3})\s+(\d{1,2})/);
  if (monthMatch) {
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const m = months[monthMatch[1]];
    if (m === undefined) return null;
    const now = new Date();
    const year = now.getFullYear();
    const day = parseInt(monthMatch[2], 10);
    let y = year;
    let candidate = new Date(isoFromZonedParts({ year: y, month: m + 1, day, hour: 19, minute: 0, second: 0 }));
    if (candidate < now) {
      y = year + 1;
      candidate = new Date(isoFromZonedParts({ year: y, month: m + 1, day, hour: 19, minute: 0, second: 0 }));
    }
    return candidate.toISOString();
  }
  return null;
}

const DETAIL_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 5;

export const grayAreaScraper: Scraper = {
  id: "grayarea",
  name: "Gray Area",

  async fetch() {
    return fetchHtml(EVENTS_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(EVENTS_URL);

    $("a[href*='/event/'], a.item-link[href*='/event/']").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href");
      if (!href || !href.includes("/event/")) return;
      
      // Gray Area uses h5.item-title inside the link for the event title.
      const title = $a.find("h5.item-title, .item-title").first().text().trim();
      if (!title || title.length < 3) return;
      
      // Clean up title: replace <br> tags with spaces, then remove all HTML tags, normalize whitespace.
      const cleanTitle = title.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!cleanTitle || cleanTitle.length < 3) return;

      // Date is in .date div (e.g. "01/21")
      const $card = $a.closest(".item, article, [class*='event']").length
        ? $a.closest(".item, article, [class*='event']")
        : $a.parent();
      const dateText = $card.find(".date").first().text().trim() || $card.text();
      const dateStr = parseDateFromText(dateText);
      if (!dateStr) return;

      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      events.push({
        title: cleanTitle,
        startAt: dateStr,
        sourceUrl: fullUrl,
        locationName: "Gray Area",
        tags: ["workshop", "exhibit", "learn"],
      });
    });

    // Enrich with descriptions from detail pages
    const enrichedEvents: RawEvent[] = [];
    for (let i = 0; i < events.length; i += CONCURRENCY) {
      const chunk = events.slice(i, i + CONCURRENCY);
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
              } else {
                const content = $("main, article, .content, .event-detail, .item-description").first().text().trim();
                if (content && content.length > 50 && content.length < 500) {
                  description = content.slice(0, 300);
                }
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
