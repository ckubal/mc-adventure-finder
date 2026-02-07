import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml } from "../fetchHtml";

const CALENDAR_URL = "https://www.bottomofthehill.com/calendar.html";
const BASE_URL = "https://www.bottomofthehill.com";

/** Parse "Friday February 6 2026" or "Thurs day February 5" (split across spans) + name="20260205" for year. */
function parseDate(
  dateText: string,
  anchorName?: string
): { year: number; month: number; day: number } | null {
  const trimmed = dateText.replace(/\s+/g, " ").trim();
  const yearFromName = anchorName ? parseInt(anchorName.slice(0, 4), 10) : new Date().getFullYear();
  const m = trimmed.match(/(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+(\w+)\s+(\d{1,2})/i);
  if (!m) return null;
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const month = months[m[1].toLowerCase()];
  if (month == null) return null;
  const day = parseInt(m[2], 10);
  const yearMatch = trimmed.match(/(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : yearFromName;
  if (!year || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Parse "8:00PM" or "8:30PM" from time text. */
function parseTime(text: string): { hours: number; minutes: number } {
  const m = text.trim().match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);
  if (!m) return { hours: 20, minutes: 0 };
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3].toLowerCase() === "pm" && hours < 12) hours += 12;
  if (m[3].toLowerCase() === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

function toISO(year: number, month: number, day: number, hours: number, minutes: number): string {
  return new Date(year, month, day, hours, minutes, 0).toISOString();
}

export const bottomOfTheHillScraper: Scraper = {
  id: "bottomofthehill",
  name: "Bottom of the Hill",

  async fetch() {
    return fetchHtml(CALENDAR_URL);
  },

  parse(html: string): RawEvent[] {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];

    // Event blocks: td with .band (and usually .date, details link). Details link is a[href*="/20"][href$=".html"] same domain, e.g. /20260206.html
    $("td").each((_, tdEl) => {
      const $td = $(tdEl);
      const $bands = $td.find(".band");
      if (!$bands.length) return;

      const $detailLink = $td.find('a[href*=".html"]').filter((__, el) => {
        const href = $(el).attr("href") ?? "";
        const path = href.replace(/^https?:\/\/[^/]+/, "") || href;
        return /\/?\d{8}\.html$/.test(path);
      }).first();
      const href = $detailLink.attr("href");
      if (!href) return;

      const fullUrl = href.startsWith("http") ? href : new URL(href, BASE_URL).href;
      const nameAttr = $td.find('a[name]').attr("name");
      const dateText = $td.find(".date").text().replace(/\s+/g, " ").trim();
      const dayInfo = parseDate(dateText, nameAttr);
      if (!dayInfo) return;

      const timeText = $td.find(".time").first().text();
      const musicMatch = timeText.match(/music at\s*(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);
      const timeStr = musicMatch
        ? `${musicMatch[1]}:${musicMatch[2] ?? "00"} ${musicMatch[3]}`
        : timeText;
      const { hours, minutes } = parseTime(timeStr);

      const startAt = toISO(dayInfo.year, dayInfo.month, dayInfo.day, hours, minutes);
      const title = $bands
        .map((__, el) => $(el).text().trim())
        .get()
        .filter(Boolean)
        .join(", ") || "Show at Bottom of the Hill";

      // Extract description: look for .note or .note2, or genre text
      const genres = $td.find(".genre")
        .map((__, el) => $(el).text().trim())
        .get()
        .filter(Boolean)
        .map((g) => (g.startsWith("ock") ? "r" + g : g));
      const notes = $td.find(".note, .note2")
        .map((__, el) => $(el).text().trim())
        .get()
        .filter(Boolean);
      let description: string | null = null;
      if (notes.length > 0) {
        description = notes.join(" ");
      } else if (genres.length > 0) {
        description = `Genres: ${genres.join(", ")}`;
      }

      events.push({
        title,
        startAt,
        sourceUrl: fullUrl,
        sourceEventId: nameAttr ?? undefined,
        description,
        locationName: "Bottom of the Hill",
        locationAddress: "1233 17th St, San Francisco, CA 94107",
        tags: ["concert", "live music"],
      });
    });

    return events;
  },
};
