import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import { extractJsonLdEvent } from "../jsonLdEvent";

const BASE_URL = "https://envelop.us";
const EVENTS_URL = `${BASE_URL}/events`;

function parseDate(dateStr: string, timeStr: string): string {
  const trimmed = dateStr.trim();
  const timeTrimmed = timeStr.trim().toLowerCase();
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
  let hours = 19;
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

export const envelopScraper: Scraper = {
  id: "envelop",
  name: "Envelop",

  async fetch() {
    return fetchHtml(EVENTS_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(EVENTS_URL);

    // Envelop uses Next.js with event URLs like /event/ESF20260209-fripp+eno-evening-star-listen
    // The date is encoded in the URL: ESF20260209 = Feb 9, 2026
    $("a[href*='/event/']").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href");
      if (!href || !href.includes("/event/")) return;
      
      // Extract date from URL: ESF20260209 -> 2026-02-09
      const urlMatch = href.match(/ESF(\d{8})/);
      if (!urlMatch) return;
      const dateStr = urlMatch[1]; // "20260209"
      const year = parseInt(dateStr.slice(0, 4), 10);
      const month = parseInt(dateStr.slice(4, 6), 10);
      const day = parseInt(dateStr.slice(6, 8), 10);
      if (!year || !month || !day) return;
      
      // Get title from alt text of image (clean HTML from text() first)
      let title = $a.find("img").attr("alt")?.replace(/^Event image for\s+/i, "").trim();
      if (!title) {
        // Fallback: extract from link text, removing HTML tags
        const linkText = $a.text().trim();
        title = linkText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
      if (!title || title.length < 2) {
        // Last resort: derive from URL slug
        title = href.split("/").pop()?.replace(/ESF\d{8}-/, "").replace(/[+-]/g, " ").replace(/-/g, " ").trim();
      }
      if (!title || title.length < 2) return;
      
      // Default time: 7:00pm
      const startAt = new Date(year, month - 1, day, 19, 0, 0).toISOString();
      
      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      events.push({
        title,
        startAt,
        sourceUrl: fullUrl,
        locationName: "Envelop",
        tags: ["concert", "film"],
      });
    });

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
              const $ = cheerio.load(detailHtml);
              const metaDesc = $('meta[name="description"], meta[property="og:description"]').attr("content");
              if (metaDesc && metaDesc.length > 20) {
                description = metaDesc.trim();
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
