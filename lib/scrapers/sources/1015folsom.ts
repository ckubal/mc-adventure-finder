import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml } from "../fetchHtml";

const CALENDAR_URL = "https://1015.com/";
const VENUE_NAME = "1015 Folsom";

const MONTH_NAMES: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** Ticket link hrefs we treat as event URL (from site structure, not word match). */
const TICKET_HOST_PATTERNS = ["posh.vip", "eventim.", "ra.co", "eventbrite", "ticket"];

function parseDateFromHeading(dateText: string): { year: number; month: number; day: number } | null {
  const t = dateText.trim();
  // e.g. "Sunday, February 8th" or "Friday, February 13th"
  const match = t.match(/,?\s*([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*$/);
  if (!match) return null;
  const monthName = (match[1] ?? "").toLowerCase();
  const month = MONTH_NAMES[monthName];
  if (month === undefined) return null;
  const day = parseInt(match[2] ?? "0", 10);
  if (!day || day > 31) return null;
  const now = new Date();
  let year = now.getFullYear();
  const d = new Date(year, month, day);
  if (d < now) year += 1;
  return { year, month, day };
}

function findTicketUrl($: cheerio.CheerioAPI, $column: cheerio.Cheerio<cheerio.Element>): string | null {
  const $container = $column.closest(".vc_column-inner");
  if (!$container.length) return null;
  const links = $container.find('a[target="_blank"][href]');
  for (let i = 0; i < links.length; i++) {
    const href = $(links[i]).attr("href");
    if (!href || href.startsWith("https://1015.com")) continue;
    const lower = href.toLowerCase();
    if (TICKET_HOST_PATTERNS.some((p) => lower.includes(p))) return href;
  }
  return null;
}

export const folsom1015Scraper: Scraper = {
  id: "1015folsom",
  name: "1015 Folsom",

  async fetch() {
    return fetchHtml(CALENDAR_URL);
  },

  parse(html: string): RawEvent[] {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];

    $(".wpb_text_column.wpb_content_element").each((_, el) => {
      const $col = $(el);
      const $wrapper = $col.find(".wpb_wrapper").first();
      const $h4 = $wrapper.find("h4").first();
      const $h3 = $wrapper.find("h3").first();
      if (!$h4.length || !$h3.length) return;

      const dateText = $h4.text().trim();
      const parsed = parseDateFromHeading(dateText);
      if (!parsed) return;

      const title = ($h3.html() ?? "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, "")
        .trim()
        .replace(/\s+/g, " ");
      if (!title || title.length < 2) return;

      const ticketUrl = findTicketUrl($, $col);
      const sourceUrl = ticketUrl ?? CALENDAR_URL;

      const { year, month, day } = parsed;
      const startAt = new Date(year, month, day, 21, 0, 0).toISOString();

      events.push({
        title,
        startAt,
        sourceUrl,
        locationName: VENUE_NAME,
        tags: ["concert"],
      });
    });

    return events;
  },
};
