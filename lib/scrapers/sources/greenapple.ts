import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import { extractJsonLdEvent } from "../jsonLdEvent";
import { isoFromZonedParts } from "../timezone";

const BASE_URL = "https://greenapplebooks.com";
const EVENTS_URL = `${BASE_URL}/events`;
const TARGET_DAYS_AHEAD = 60;

function parseDate(dateStr: string, timeStr: string): string {
  // e.g. "Thu, 1/8/2026" and "7:00pm"
  const trimmed = dateStr.trim();
  const timeTrimmed = timeStr.trim().toLowerCase();
  if (!trimmed) return "";
  // Parse "1/8/2026" and "7:00pm" in America/Los_Angeles
  const parts = trimmed.split(",").map((s) => s.trim());
  const datePart = parts[parts.length - 1]; // "1/8/2026"
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

export const greenAppleScraper: Scraper = {
  id: "greenapple",
  name: "Green Apple Books",

  async fetch() {
    // Green Apple has month-scoped list views at /events/YYYY/MM. The root /events only
    // covers the current month; to hit a 60-day horizon we fetch multiple months.
    const now = new Date();
    const cutoff = new Date(now.getTime() + TARGET_DAYS_AHEAD * 24 * 60 * 60 * 1000);
    const pages: string[] = [];

    let y = now.getFullYear();
    let m = now.getMonth(); // 0-based
    for (let i = 0; i < 6; i++) {
      const monthUrl = `${EVENTS_URL}/${y}/${String(m + 1).padStart(2, "0")}`;
      pages.push(await fetchHtml(monthUrl));

      // advance to next month
      const nextMonth = new Date(y, m + 1, 1);
      y = nextMonth.getFullYear();
      m = nextMonth.getMonth();
      if (nextMonth > cutoff) break;
    }

    return JSON.stringify(pages);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const events: RawEvent[] = [];
    const base = new URL(EVENTS_URL);
    const seenUrls = new Set<string>();

    const pages: string[] = (() => {
      const trimmed = html.trim();
      if (trimmed.startsWith("[")) {
        try {
          const arr = JSON.parse(trimmed) as unknown;
          if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) return arr as string[];
        } catch {
          // fall through
        }
      }
      return [html];
    })();

    function parseMonthPage(pageHtml: string) {
      const $ = cheerio.load(pageHtml);

      $("article.event-list").each((_, el) => {
        const $el = $(el);
        const $a = $el.find("h3.event-list__title a[href^='/event/']").first();
        const href = $a.attr("href");
        if (!href) return;
        const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
        if (seenUrls.has(fullUrl)) return;

        const title = $a.text().replace(/\s+/g, " ").trim();
        if (!title || title.length < 3) return;

        const text = $el.text().replace(/\s+/g, " ").trim();
        const dateMatch = text.match(/Date:\s*([A-Za-z]{3},\s*\d{1,2}\/\d{1,2}\/\d{4})/i);
        const timeMatch = text.match(/Time:\s*([0-9:\sAPMapm\-]+)(?:Place:|Sign Up|View Event Details|$)/i);
        const dateStr = dateMatch?.[1]?.trim() ?? "";
        const timeStr = (timeMatch?.[1]?.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)/i)?.[1] ?? "7:00pm").trim();
        if (!dateStr) return;
        const startAt = parseDate(dateStr, timeStr);
        if (!startAt) return;

        // Place parsing: first non-empty line after "Place:" is usually the venue name.
        let locationName: string | undefined;
        let locationAddress: string | undefined;
        const placeBlock = text.split(/Place:\s*/i)[1];
        if (placeBlock) {
          const chunk = placeBlock.split(/Sign Up|View Event Details/i)[0] ?? placeBlock;
          const parts = chunk.split(/ {2,}|\n/).map((s) => s.trim()).filter(Boolean);
          if (parts.length > 0 && parts[0].length < 120) locationName = parts[0];
          if (parts.length > 1) locationAddress = parts.slice(1, 5).join(", ").slice(0, 200);
        }

        const excerpt = $el.find(".event-list__excerpt, .event-list__body, p").first().text().trim();
        const description = excerpt && excerpt.length > 20 ? excerpt.slice(0, 300) : null;

        seenUrls.add(fullUrl);
        events.push({
          title,
          startAt,
          sourceUrl: fullUrl,
          locationName: locationName || undefined,
          locationAddress: locationAddress || undefined,
          description,
          tags: ["book"],
        });
      });
    }

    pages.forEach(parseMonthPage);

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
              // Fallback: extract from meta description or page content
              const $ = cheerio.load(detailHtml);
              const metaDesc = $('meta[name="description"]').attr("content");
              if (metaDesc && metaDesc.length > 20) {
                description = metaDesc.trim();
              } else {
                const content = $("main, article, .content, .event-detail").first().text().trim();
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
