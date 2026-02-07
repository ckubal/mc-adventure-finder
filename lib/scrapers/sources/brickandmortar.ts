import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import { extractJsonLdEvent, titleFromJsonLdEvent, startDateFromJsonLdEvent } from "../jsonLdEvent";

const BASE_URL = "https://www.brickandmortarmusic.com";
const CALENDAR_URL = `${BASE_URL}/calendar/`;

function parseDate(dateStr: string, timeStr: string): string {
  const trimmed = dateStr.trim();
  const timeTrimmed = timeStr.trim().toLowerCase();
  if (!trimmed) return "";
  const datePart = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/) ?? trimmed.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (!datePart) return "";
  let month: number;
  let day: number;
  let year: number;
  if (typeof datePart[0] === "string" && datePart[0].includes("/")) {
    const [, m, d, y] = (datePart[0].match(/(\d+)\/(\d+)\/(\d+)/) ?? []) as string[];
    if (!m || !d || !y) return "";
    month = parseInt(m, 10) - 1;
    day = parseInt(d, 10);
    year = parseInt(y, 10);
  } else {
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    month = months[(datePart[1] as string)?.slice(0, 3)] ?? 0;
    day = parseInt(datePart[2] as string, 10);
    year = parseInt(datePart[3] as string, 10);
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
  return new Date(year, month, day, hours, minutes, 0).toISOString();
}

const DETAIL_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 5;

export const brickAndMortarScraper: Scraper = {
  id: "brickandmortar",
  name: "Brick & Mortar",

  async fetch() {
    return fetchHtml(CALENDAR_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(CALENDAR_URL);

    // Brick & Mortar uses .tw-section for each event (same as Cafe Du Nord).
    $(".tw-section").each((_, el) => {
      const $section = $(el);
      const $nameLink = $section.find(".tw-name a[href*='tm-event']").first();
      const href = $nameLink.attr("href");
      if (!href) return;

      const title = $nameLink.text().trim();
      if (!title || title.length < 3) return;

      // Date is in .tw-event-date (e.g. "2.4" format like Cafe Du Nord)
      const dateStr = $section.find(".tw-event-date").first().text().trim();
      if (!dateStr) return;
      
      // Parse "2.4" format (month.day)
      const dotMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})$/);
      if (!dotMatch) return;
      const month = parseInt(dotMatch[1], 10) - 1;
      const day = parseInt(dotMatch[2], 10);
      const now = new Date();
      let year = now.getFullYear();
      const d = new Date(year, month, day);
      if (d < now) year += 1;

      // Time is in .tw-event-time (e.g. "Show: 8:00PM")
      const timeText = $section.find(".tw-event-time").first().text().trim() || "8:00PM";
      const timeMatch = timeText.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);
      let hours = 20;
      let minutes = 0;
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        if (timeMatch[3].toLowerCase() === "pm" && hours < 12) hours += 12;
        if (timeMatch[3].toLowerCase() === "am" && hours === 12) hours = 0;
      }

      const startAt = new Date(year, month, day, hours, minutes, 0).toISOString();
      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      
      events.push({
        title,
        startAt,
        sourceUrl: fullUrl,
        locationName: "Brick & Mortar",
        tags: ["concert"],
      });
    });

    // Enrich with descriptions from detail pages (similar to Cafe Du Nord)
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
