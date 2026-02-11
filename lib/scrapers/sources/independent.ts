import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import {
  extractJsonLdEvent,
  titleFromJsonLdEvent,
  startDateFromJsonLdEvent,
  extractFallbackTitleFromJsonLd,
} from "../jsonLdEvent";
import { isoFromZonedParts, parseIsoAssumingTimeZone } from "../timezone";

const BASE_URL = "https://www.theindependentsf.com";
const CALENDAR_URL = `${BASE_URL}/calendar/`;

const DETAIL_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 5;

function parseDate(dateStr: string, timeStr: string): string {
  const trimmed = dateStr.trim();
  const timeTrimmed = timeStr.trim().toLowerCase().replace(/^show:\s*/i, "");
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
  return isoFromZonedParts({ year, month: month + 1, day, hour: hours, minute: minutes, second: 0 });
}

/** Parse ISO local or offset date (e.g. "2026-02-12T20:00" or "2026-02-12T20:00-08:00") to ISO string. */
function parseStartDate(iso: string): string | null {
  return parseIsoAssumingTimeZone(iso);
}

export const independentScraper: Scraper = {
  id: "independent",
  name: "The Independent",

  async fetch() {
    return fetchHtml(CALENDAR_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const $ = cheerio.load(html);
    const base = new URL(CALENDAR_URL);

    type CalendarRow = { href: string; fullUrl: string; dateStr: string; timeStr: string; linkText: string; slugTitle: string };
    const rows: CalendarRow[] = [];

    $(".tw-cal-event").each((_, el) => {
      const $event = $(el);
      const $nameLink = $event.find(".tw-name a[href*='tm-event']").first();
      const href = $nameLink.attr("href");
      if (!href) return;

      const dateStr = $event.find(".tw-event-date").first().text().trim();
      if (!dateStr) return;

      const timeStr =
        $event.find(".tw-calendar-event-time").first().text().trim() ||
        $event.text().match(/Show:\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i)?.[0] ||
        "8:00 PM";

      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      const linkText = ($nameLink.attr("title") || $nameLink.text()).trim();
      const slugTitle =
        href
          .split("/")
          .filter(Boolean)
          .pop()
          ?.replace(/-/g, " ") ?? "Show at The Independent";

      rows.push({ href, fullUrl, dateStr, timeStr, linkText, slugTitle });
    });

    const calendarStartAt = (row: CalendarRow) => parseDate(row.dateStr, row.timeStr);

    const events: RawEvent[] = [];

    const shouldFetchDetail = (url: string) =>
      /ticketweb\.com/i.test(url) || /theindependentsf\.com\/tm-event\//i.test(url);

    const eventSlug = (url: string) => url.split("/").filter(Boolean).pop()?.replace(/\/$/, "") ?? "";

    const enrichWithJsonLd = async (row: CalendarRow): Promise<RawEvent> => {
      let title = row.slugTitle;
      let startAt = calendarStartAt(row);
      let description: string | null = null;

      if (shouldFetchDetail(row.fullUrl)) {
        try {
          const { html: detailHtml, finalUrl } = await fetchHtmlWithUrl(row.fullUrl, DETAIL_FETCH_TIMEOUT_MS);

          const ld = extractJsonLdEvent(detailHtml);
          if (ld) {
            const ldTitle = titleFromJsonLdEvent(ld);
            if (ldTitle && ldTitle.length > 1) title = ldTitle;
            const ldStart = startDateFromJsonLdEvent(ld);
            if (ldStart) {
              const parsed = parseStartDate(ldStart);
              if (parsed) startAt = parsed;
            }
            if (ld.description && typeof ld.description === "string") {
              const desc = ld.description.replace(/<[^>]+>/g, "").trim();
              if (desc.length > 0) description = desc;
            }
          }

          if (!ld || !titleFromJsonLdEvent(ld)) {
            const fallback = extractFallbackTitleFromJsonLd(detailHtml);
            if (fallback && fallback.length > 1) title = fallback;
          }

          if (title === row.slugTitle) {
            const slug = eventSlug(row.fullUrl);
            const $ = cheerio.load(detailHtml);
            const ticketwebHref = $('a[href*="ticketweb.com"]')
              .toArray()
              .map((el) => $(el).attr("href"))
              .find((href) => href && slug && href.includes(slug));
            if (ticketwebHref) {
              try {
                const twHtml = await fetchHtml(ticketwebHref.replace(/&amp;/g, "&"), DETAIL_FETCH_TIMEOUT_MS);
                const twLd = extractJsonLdEvent(twHtml);
                const twTitle = twLd ? titleFromJsonLdEvent(twLd) : null;
                if (twTitle && twTitle.length > 1) title = twTitle;
                const twStart = twLd ? startDateFromJsonLdEvent(twLd) : null;
                if (twStart) {
                  const parsed = parseStartDate(twStart);
                  if (parsed) startAt = parsed;
                }
              } catch {
                // keep title from fallback or slug
              }
            }
          }
        } catch {
          // keep slug title and calendar date
        }
      }

      return {
        title,
        startAt,
        sourceUrl: row.fullUrl,
        locationName: "The Independent",
        description,
        tags: ["concert"],
      };
    };

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(enrichWithJsonLd));
      events.push(...chunkResults);
    }

    return events;
  },
};
