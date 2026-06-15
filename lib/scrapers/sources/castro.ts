import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchWithPlaywrightWait } from "../fetchPlaywright";
import { parseIsoAssumingTimeZone } from "../timezone";

const CALENDAR_URL = "https://thecastro.com/calendar/";

export const castroScraper: Scraper = {
  id: "castro",
  name: "The Castro Theatre",

  async fetch() {
    return fetchWithPlaywrightWait(CALENDAR_URL, "article.event", 45_000);
  },

  parse(html: string): RawEvent[] {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const seen = new Set<string>();

    $("article.event").each((_, el) => {
      const $e = $(el);
      const href = $e.find('a[href*="/events/"]').first().attr("href");
      const startRaw = $e.find('[itemprop="startDate"]').attr("content")?.trim();
      if (!href || !startRaw) return;

      let title = $e.find('[itemprop="name"]').text().trim();
      title = title.replace(/\s*The Castro\s*$/i, "").trim();
      if (!title) return;

      const startAt = parseIsoAssumingTimeZone(startRaw);
      if (!startAt) return;

      const fullUrl = href.startsWith("http") ? href : new URL(href, CALENDAR_URL).href;
      const key = `${fullUrl}|${startAt}`;
      if (seen.has(key)) return;
      seen.add(key);

      events.push({
        title,
        startAt,
        sourceUrl: fullUrl,
        locationName: "The Castro Theatre",
        locationAddress: "429 Castro St, San Francisco, CA 94114",
        tags: ["concert", "music"],
      });
    });

    return events;
  },
};
