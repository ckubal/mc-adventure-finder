import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import { extractJsonLdEvent } from "../jsonLdEvent";

const BASE_URL = "https://greenapplebooks.com";
const EVENTS_URL = `${BASE_URL}/events`;

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
  const d = new Date(year, month - 1, day, hours, minutes, 0);
  return d.toISOString();
}

const DETAIL_FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 5;

export const greenAppleScraper: Scraper = {
  id: "greenapple",
  name: "Green Apple Books",

  async fetch() {
    return fetchHtml(EVENTS_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(EVENTS_URL);

    const navLikeTitles = /^(main\s+navigation|menu|events|home|about|contact|search|login|sign\s+in)$/i;
    const dateOnlyTitle = /^([A-Za-z]+\s+)?\d{1,2}\/\d{1,2}\/\d{2,4}$|^[A-Za-z]+\s+\d{4}$/; // e.g. "2/1/2026" or "February 2026"

    $(".event-item, .event, [class*='event']").each((_, el) => {
      const $el = $(el);
      const link = $el.find('a[href*="/events/"], a[href*="event"]').first().attr("href");
      const title =
        $el.find("h3, h2, .event-title, [class*='title']").first().text().trim() ||
        $el.find("a").first().text().trim();
      if (!title || title.length < 5 || navLikeTitles.test(title.trim()) || dateOnlyTitle.test(title.trim())) return;

      let dateStr = "";
      let timeStr = "7:00pm";
      $el.find("time, .date, [class*='date']").each((__, node) => {
        const text = $(node).text().trim();
        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(text)) dateStr = text;
      });
      if (!dateStr) {
        const fullText = $el.text();
        const dateMatch = fullText.match(/(\w{3},?\s*)?(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) dateStr = dateMatch[0].trim();
      }
      const timeMatch = $el.text().match(/Time:\s*([^\n]+?)(?:\n|$)/i);
      if (timeMatch) timeStr = timeMatch[1].trim();

      let locationName: string | null = null;
      let locationAddress: string | null = null;
      const placeMatch = $el.text().match(/Place:\s*([^\n]+?)(?:\n|$)/i);
      if (placeMatch) {
        const place = placeMatch[1].trim();
        const lines = place.split(/\s*\n\s*/).filter(Boolean);
        locationName = lines[0] || null;
        locationAddress = lines.slice(1).join(", ") || null;
      }

      const href = link?.startsWith("http") ? link : new URL(link || "/", base).href;
      const startAt = parseDate(dateStr, timeStr);
      if (!startAt) return;

      events.push({
        title,
        startAt,
        sourceUrl: href,
        locationName: locationName || undefined,
        locationAddress: locationAddress || undefined,
        tags: ["book"],
      });
    });

    // Fallback: look for any list items or cards that look like events
    if (events.length === 0) {
      $("a[href*='/events/']").each((_, el) => {
        const $a = $(el);
        const href = $a.attr("href");
        if (!href) return;
        const title = $a.find("h3, h2").first().text().trim() || $a.text().trim().split("\n")[0]?.trim();
        if (!title || title.length < 5 || navLikeTitles.test(title.trim()) || dateOnlyTitle.test(title.trim())) return;
        const $parent = $a.closest("li, .event, [class*='event']");
        const text = $parent.length ? $parent.text() : $a.parent().text();
        const dateMatch = text.match(/(\w{3},?\s*)?(\d{1,2}\/\d{1,2}\/\d{4})/);
        const timeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
        if (!dateMatch) return;
        const dateStr = dateMatch[0].trim();
        const timeStr = timeMatch ? timeMatch[1].trim() : "7:00pm";
        const startAt = parseDate(dateStr, timeStr);
        if (!startAt) return;
        const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
        events.push({
          title,
          startAt,
          sourceUrl: fullUrl,
          tags: ["book"],
        });
      });
    }

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
