import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml } from "../fetchHtml";

const BASE_URL = "https://roxie.com";
const CALENDAR_URL = `${BASE_URL}/calendar/`;

function parseTime(timeStr: string, baseDate: Date): Date {
  const m = timeStr.trim().toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return baseDate;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "pm" && hours < 12) hours += 12;
  if (m[3] === "am" && hours === 12) hours = 0;
  const d = new Date(baseDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export const roxieScraper: Scraper = {
  id: "roxie",
  name: "Roxie Theater",

  async fetch() {
    return fetchHtml(CALENDAR_URL);
  },

  parse(html: string): RawEvent[] {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(CALENDAR_URL);

    // Roxie calendar: film links with showtimes like "2:40 pm" or "6:40 pm"
    // Structure: links to /film/slug with time in same cell or nearby
    $("a[href*='/film/']").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href");
      if (!href) return;
      const title = $a.text().trim();
      if (!title || title.length < 2) return;

      const $cell = $a.closest("td").length ? $a.closest("td") : $a.parent();
      const cellText = $cell.text();
      const timeMatch = cellText.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)/gi);
      const times = timeMatch || ["7:00 pm"];

      const dateMatch = cellText.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/);
      const monthNames: Record<string, number> = {
        January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
        July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
      };
      let baseDate: Date;
      if (dateMatch) {
        const month = monthNames[dateMatch[1]] ?? 0;
        baseDate = new Date(
          parseInt(dateMatch[3], 10),
          month,
          parseInt(dateMatch[2], 10),
          0,
          0,
          0
        );
      } else {
        const h2 = $a.closest("table").prevAll("h2").first().text();
        const monthYearMatch = h2.match(/([A-Za-z]+)\s+(\d{4})/);
        if (monthYearMatch) {
          const month = monthNames[monthYearMatch[1]] ?? new Date().getMonth();
          baseDate = new Date(parseInt(monthYearMatch[2], 10), month, 1, 0, 0, 0);
        } else {
          baseDate = new Date();
        }
      }

      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      for (const timeStr of times) {
        const startAt = parseTime(timeStr, baseDate);
        events.push({
          title,
          startAt: startAt.toISOString(),
          sourceUrl: fullUrl,
          locationName: "Roxie Theater",
          locationAddress: "3125 16th Street, San Francisco",
          tags: ["film"],
        });
      }
    });

    return events;
  },
};
