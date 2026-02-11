import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import { extractJsonLdEvent } from "../jsonLdEvent";
import { dateFromZonedParts, isoFromZonedParts } from "../timezone";

const BASE_URL = "https://booksmith.com";
const EVENTS_URL = `${BASE_URL}/events/list/upcoming-events`;

function parseDate(dateStr: string, timeStr: string): string {
  const trimmed = dateStr.trim();
  const timeTrimmed = timeStr.trim().toLowerCase();
  if (!trimmed) return "";
  const parts = trimmed.split(",").map((s) => s.trim());
  const datePart = parts[parts.length - 1];
  const [month, day, year] = datePart.split("/").map((s) => parseInt(s, 10));
  if (!year || !month || !day) return "";
  let hours = 19;
  let minutes = 0;
  if (timeTrimmed && timeTrimmed !== "all day") {
    const match = timeTrimmed.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (match) {
      hours = parseInt(match[1], 10);
      minutes = match[2] ? parseInt(match[2], 10) : 0;
      if (match[3] === "pm" && hours < 12) hours += 12;
      if (match[3] === "am" && hours === 12) hours = 0;
    }
  }
  return isoFromZonedParts({ year, month, day, hour: hours, minute: minutes, second: 0 });
}

const DETAIL_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 5;

export const booksmithScraper: Scraper = {
  id: "booksmith",
  name: "The Booksmith",

  async fetch() {
    return fetchHtml(EVENTS_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(EVENTS_URL);

    // Booksmith uses article.event-list for each event.
    $("article.event-list").each((_, el) => {
      const $article = $(el);
      
      // Title is in h3.event-list__title > a
      const $titleLink = $article.find("h3.event-list__title a").first();
      const title = $titleLink.text().trim();
      if (!title || title.length < 3) return;
      
      // Internal event link (e.g. /event/queerlove)
      const href = $titleLink.attr("href");
      if (!href || !href.startsWith("/event/")) return;
      
      // Date: .event-list__date--month (e.g. "Feb") and .event-list__date--day (e.g. "17")
      const monthText = $article.find(".event-list__date--month").first().text().trim();
      const dayText = $article.find(".event-list__date--day").first().text().trim();
      if (!monthText || !dayText) return;
      
      // Parse month name to number
      const months: Record<string, number> = {
        Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
        Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
      };
      const month = months[monthText.slice(0, 3)];
      if (!month) return;
      const day = parseInt(dayText, 10);
      if (!day || day < 1 || day > 31) return;
      
      // Assume current year, adjust if date has passed
      const now = new Date();
      let year = now.getFullYear();
      const eventDate = dateFromZonedParts({ year, month, day, hour: 19, minute: 0, second: 0 });
      if (eventDate < now) year += 1;
      
      const startAt = isoFromZonedParts({ year, month, day, hour: 19, minute: 0, second: 0 });
      
      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      events.push({
        title,
        startAt,
        sourceUrl: fullUrl,
        locationName: "The Booksmith",
        tags: ["book"],
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
              const metaDesc = $('meta[name="description"]').attr("content");
              if (metaDesc && metaDesc.length > 20) {
                description = metaDesc.trim();
              } else {
                const content = $("main, article, .content, .event-detail, .event-description").first().text().trim();
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
