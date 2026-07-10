import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchWithPlaywrightWait } from "../fetchPlaywright";
import { dateFromZonedParts, isoFromZonedParts } from "../timezone";

const BASE_URL = "https://booksmith.com";
const EVENTS_URL = `${BASE_URL}/events/list/upcoming-events`;

export const booksmithScraper: Scraper = {
  id: "booksmith",
  name: "The Booksmith",

  async fetch() {
    // booksmith.com sits behind a WAF that 403s plain HTTP; a real browser passes.
    return fetchWithPlaywrightWait(EVENTS_URL, "article.event-list", 30_000);
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

    // Detail pages sit behind the same WAF (403 on plain HTTP), and fetching each with
    // Playwright would be too slow on Render, so we skip description enrichment. The list
    // gives us title, date and link — enough for the agenda.
    return events;
  },
};
