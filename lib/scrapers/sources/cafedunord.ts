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
  const t = cleanCafeTitle(String(metaTitle));
  return t.length > 1 ? t : null;
}

/**
 * Turn a calendar/meta title into a clean event name. Handles:
 *  - the calendar anchor's title attr: "Event Name - <TITLE> | Event Date - 09 July"
 *  - the detail page og:title suffix: "<TITLE> % in San Francisco at Cafe du Nord %"
 */
function cleanCafeTitle(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/^\s*Event\s+Name\s*-\s*/i, "")
    .replace(/\s*\|\s*Event\s+Date\s*-.*$/i, "")
    .replace(/\s*%\s*in\s+San\s+Francisco\s+at\s+Cafe\s+du\s+Nord\s*%?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
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

    type Row = { fullUrl: string; dateStr: string; timeStr: string; slugTitle: string; calTitle: string | null };
    const rows: Row[] = [];
    const seenUrls = new Set<string>();

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
      // The calendar renders each event more than once (desktop + mobile views); dedupe by URL.
      if (seenUrls.has(fullUrl)) return;
      seenUrls.add(fullUrl);

      // The calendar anchor carries a clean per-event title in its title/aria-label
      // attribute — use it directly instead of hopping to a shared TicketWeb link.
      const rawAttr =
        $nameLink.attr("title") ||
        $nameLink.attr("aria-label") ||
        $nameLink.text() ||
        "";
      const calTitle = cleanCafeTitle(rawAttr) || null;

      const slugTitle =
        href
          .split("/")
          .filter(Boolean)
          .pop()
          ?.replace(/-/g, " ") ?? "Show at Cafe Du Nord";

      rows.push({ fullUrl, dateStr, timeStr, slugTitle, calTitle });
    });

    const calendarStartAt = (row: Row) => parseTwDate(row.dateStr, row.timeStr);

    const shouldFetch = (url: string) => /cafedunord\.com\/tm-event\//i.test(url) || /ticketweb\.com/i.test(url);

    const enrich = async (row: Row): Promise<RawEvent> => {
      // The calendar already gives us a clean title + date per event; treat those as
      // authoritative. The detail page is only used to fill in a description (and to
      // recover a title/date if the calendar somehow lacked one).
      let title = row.calTitle || row.slugTitle;
      let startAt = calendarStartAt(row);
      let description: string | null = null;

      if (shouldFetch(row.fullUrl)) {
        try {
          const { html: detailHtml } = await fetchHtmlWithUrl(row.fullUrl, DETAIL_FETCH_TIMEOUT_MS);

          // The detail page's own metadata — never a shared "Buy Tickets" link, which
          // previously collapsed every event onto the venue's next featured show.
          if (!row.calTitle) {
            const metaTitle = titleFromTicketwebMeta(detailHtml);
            if (metaTitle && metaTitle.length > 1) {
              title = metaTitle;
            } else {
              const ld = extractJsonLdEvent(detailHtml);
              const ldTitle = ld ? titleFromJsonLdEvent(ld) : null;
              if (ldTitle) {
                const cleaned = cleanCafeTitle(ldTitle);
                if (cleaned.length > 1) title = cleaned;
              } else {
                const fallback = extractFallbackTitleFromJsonLd(detailHtml);
                if (fallback && fallback.length > 1) title = cleanCafeTitle(fallback);
              }
            }
          }

          const ld = extractJsonLdEvent(detailHtml);
          if (ld) {
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
        } catch {
          // keep calendar title and date
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
