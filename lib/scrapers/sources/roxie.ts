import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml } from "../fetchHtml";
import { isoFromZonedParts } from "../timezone";

const BASE_URL = "https://roxie.com";
const CALENDAR_URL = `${BASE_URL}/calendar/`;

type YMD = { year: number; month: number; day: number };

function parseTimeToIso(timeStr: string, ymd: YMD): string {
  const m = timeStr.trim().toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  let hours = 19;
  let minutes = 0;
  if (m) {
    hours = parseInt(m[1], 10);
    minutes = m[2] ? parseInt(m[2], 10) : 0;
    if (m[3] === "pm" && hours < 12) hours += 12;
    if (m[3] === "am" && hours === 12) hours = 0;
  }
  return isoFromZonedParts({ year: ymd.year, month: ymd.month, day: ymd.day, hour: hours, minute: minutes, second: 0 });
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
      let ymd: YMD;
      if (dateMatch) {
        const month = monthNames[dateMatch[1]] ?? 0;
        ymd = {
          year: parseInt(dateMatch[3], 10),
          month: month + 1,
          day: parseInt(dateMatch[2], 10),
        };
      } else {
        const h2 = $a.closest("table").prevAll("h2").first().text();
        const monthYearMatch = h2.match(/([A-Za-z]+)\s+(\d{4})/);
        if (monthYearMatch) {
          const month = monthNames[monthYearMatch[1]] ?? new Date().getMonth();
          ymd = { year: parseInt(monthYearMatch[2], 10), month: month + 1, day: 1 };
        } else {
          const now = new Date();
          ymd = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
        }
      }

      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      for (const timeStr of times) {
        events.push({
          title,
          startAt: parseTimeToIso(timeStr, ymd),
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
