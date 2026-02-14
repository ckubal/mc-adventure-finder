import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import {
  extractJsonLdEvent,
  titleFromJsonLdEvent,
  startDateFromJsonLdEvent,
  extractFallbackTitleFromJsonLd,
} from "../jsonLdEvent";
import { dateFromZonedParts, isoFromZonedParts, parseIsoAssumingTimeZone } from "../timezone";

const BASE_URL = "https://cafedunord.com";
const CALENDAR_URL = `${BASE_URL}/calendar/`;

const DETAIL_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 5;

function decodeHtmlEntities(s: string): string {
  // Cheerio will decode HTML entities when reading text().
  return cheerio.load(`<div>${s}</div>`).text();
}

function titleFromTicketwebMeta(html: string): string | null {
  const $ = cheerio.load(html);
  const metaTitle =
    $('meta[name="title"]').attr("content") ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text();
  if (!metaTitle) return null;
  const t = decodeHtmlEntities(String(metaTitle)).replace(/\s+/g, " ").trim();
  return t.length > 1 ? t : null;
}

/** Parse TicketWeb date (e.g. "2.4") and time (e.g. "Show: 8:00 pm"). */
function parseTwDate(dateStr: string, timeStr: string): string {
  const dotMatch = dateStr.trim().match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!dotMatch) return "";
  const month = parseInt(dotMatch[1], 10) - 1;
  const day = parseInt(dotMatch[2], 10);
  const now = new Date();
  let year = now.getFullYear();
  const d = dateFromZonedParts({ year, month: month + 1, day, hour: 0, minute: 0, second: 0 });
  if (d < now) year += 1;
  let hours = 20;
  let minutes = 0;
  const timeTrimmed = timeStr.trim().toLowerCase().replace(/^show:\s*/i, "");
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

function parseStartDate(iso: string): string | null {
  return parseIsoAssumingTimeZone(iso);
}

export const cafeDuNordScraper: Scraper = {
  id: "cafedunord",
  name: "Cafe Du Nord",

  async fetch() {
    return fetchHtml(CALENDAR_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const $ = cheerio.load(html);
    const base = new URL(CALENDAR_URL);

    type Row = { fullUrl: string; dateStr: string; timeStr: string; slugTitle: string };
    const rows: Row[] = [];

    $(".tw-section").each((_, el) => {
      const $section = $(el);
      const $nameLink = $section.find(".tw-name a[href*='tm-event'], .tw-name a[href*='cafedunord']").first();
      const href = $nameLink.attr("href") || $section.find("a[href*='tm-event']").first().attr("href");
      if (!href) return;

      const dateStr = $section.find(".tw-event-date").first().text().trim();
      const timeStr = $section.find(".tw-event-time").first().text().trim() || "8:00 pm";
      const startAt = parseTwDate(dateStr, timeStr);
      if (!startAt) return;

      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      const slugTitle =
        href
          .split("/")
          .filter(Boolean)
          .pop()
          ?.replace(/-/g, " ") ?? "Show at Cafe Du Nord";

      rows.push({ fullUrl, dateStr, timeStr, slugTitle });
    });

    const calendarStartAt = (row: Row) => parseTwDate(row.dateStr, row.timeStr);
    const eventSlug = (url: string) => url.split("/").filter(Boolean).pop()?.replace(/\/$/, "") ?? "";

    const shouldFetch = (url: string) => /ticketweb\.com/i.test(url) || /cafedunord\.com\/tm-event\//i.test(url);

    const enrich = async (row: Row): Promise<RawEvent> => {
      let title = row.slugTitle;
      let startAt = calendarStartAt(row);
      let description: string | null = null;

      if (shouldFetch(row.fullUrl)) {
        try {
          const { html: detailHtml, finalUrl } = await fetchHtmlWithUrl(row.fullUrl, DETAIL_FETCH_TIMEOUT_MS);

          // If we're already on TicketWeb, get title from meta immediately.
          if (/ticketweb\.com/i.test(finalUrl)) {
            const metaTitle = titleFromTicketwebMeta(detailHtml);
            if (metaTitle) title = metaTitle;
          } else {
            // On cafedunord.com page: look for TicketWeb link and fetch it for clean title.
            const $d = cheerio.load(detailHtml);
            // Find any TicketWeb link (usually a "Buy Tickets" button).
            const ticketwebHref = $d('a[href*="ticketweb.com"][href*="/event/"]')
              .first()
              .attr("href");
            if (ticketwebHref) {
              try {
                const twHtml = await fetchHtml(ticketwebHref.replace(/&amp;/g, "&"), DETAIL_FETCH_TIMEOUT_MS);
                const twMetaTitle = titleFromTicketwebMeta(twHtml);
                if (twMetaTitle && twMetaTitle.length > 1) {
                  title = twMetaTitle;
                } else {
                  // Fallback to TicketWeb JSON-LD if meta not found.
                  const twLd = extractJsonLdEvent(twHtml);
                  const twTitle = twLd ? titleFromJsonLdEvent(twLd) : null;
                  if (twTitle && twTitle.length > 1) title = twTitle;
                }
                // Get date/time from TicketWeb if available.
                const twLd = extractJsonLdEvent(twHtml);
                const twStart = twLd ? startDateFromJsonLdEvent(twLd) : null;
                if (twStart) {
                  const parsed = parseStartDate(twStart);
                  if (parsed) startAt = parsed;
                }
              } catch {
                // Continue to use cafedunord.com page data.
              }
            }
          }

          // If we still have slug title, try JSON-LD from the detail page as fallback.
          if (title === row.slugTitle) {
            const ld = extractJsonLdEvent(detailHtml);
            if (ld) {
              let ldTitle = titleFromJsonLdEvent(ld);
              // Clean up cafedunord.com JSON-LD titles that have " % in San Francisco at Cafe du Nord %" suffix.
              if (ldTitle) {
                ldTitle = decodeHtmlEntities(ldTitle)
                  .replace(/\s*%\s*in\s+San\s+Francisco\s+at\s+Cafe\s+du\s+Nord\s*%?\s*$/i, "")
                  .trim();
              }
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

            if (title === row.slugTitle) {
              const fallback = extractFallbackTitleFromJsonLd(detailHtml);
              if (fallback && fallback.length > 1) title = fallback;
            }
          } else {
            // We have a good title from TicketWeb; still get description from detail page JSON-LD.
            const ld = extractJsonLdEvent(detailHtml);
            if (ld?.description && typeof ld.description === "string") {
              const desc = ld.description.replace(/<[^>]+>/g, "").trim();
              if (desc.length > 0) description = desc;
            }
          }
        } catch {
          // keep slug and calendar date
        }
      }

      return {
        title,
        startAt,
        sourceUrl: row.fullUrl,
        locationName: "Cafe Du Nord",
        description,
        tags: ["concert"],
      };
    };

    const events: RawEvent[] = [];
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      events.push(...(await Promise.all(chunk.map(enrich))));
    }
    return events;
  },
};
