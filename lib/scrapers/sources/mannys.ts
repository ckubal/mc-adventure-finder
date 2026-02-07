import * as cheerio from "cheerio";
import type { Scraper, RawEvent } from "../types";
import { fetchWithPlaywright } from "../fetchPlaywright";

const BASE_URL = "https://www.eventbrite.com";
const EVENTS_URL = `${BASE_URL}/o/mannys-15114280512`;

function parseStartDate(iso: string): string | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export const mannysScraper: Scraper = {
  id: "mannys",
  name: "Manny's",

  async fetch() {
    return fetchWithPlaywright(EVENTS_URL);
  },

  parse(html: string): RawEvent[] {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(EVENTS_URL);

    // Eventbrite uses JSON-LD for events - look for all JSON-LD scripts
    const scriptTags = $('script[type="application/ld+json"]');
    const seenUrls = new Set<string>();
    
    scriptTags.each((_, el) => {
      try {
        const jsonText = $(el).html();
        if (!jsonText) return;
        const data = JSON.parse(jsonText);
        
        // Handle different JSON-LD structures
        let items: unknown[] = [];
        if (Array.isArray(data)) {
          items = data;
        } else if (data["@graph"] && Array.isArray(data["@graph"])) {
          items = data["@graph"];
        } else if (data["@type"] === "Event" || data["@type"] === "ItemList") {
          items = [data];
          // If it's an ItemList, extract the itemListElement
          if (data["@type"] === "ItemList" && Array.isArray(data.itemListElement)) {
            items = data.itemListElement.map((el: unknown) => {
              if (typeof el === "object" && el !== null && "item" in el) {
                return el.item;
              }
              return el;
            });
          }
        }
        
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const obj = item as Record<string, unknown>;
          
          if (obj["@type"] === "Event" || (obj.name && obj.startDate)) {
            const url = (obj.url || obj["@id"] || obj.id) as string | undefined;
            if (!url || seenUrls.has(url) || !url.includes("eventbrite.com")) continue;
            seenUrls.add(url);
            
            const title = obj.name as string | undefined;
            if (!title || typeof title !== "string" || title.length < 2) continue;
            
            const startDate = obj.startDate as string | undefined;
            if (!startDate) continue;
            
            const startAt = parseStartDate(startDate);
            if (!startAt) continue;
            
            // Extract description from JSON-LD
            let description: string | null = null;
            if (obj.description && typeof obj.description === "string") {
              const desc = obj.description.replace(/<[^>]+>/g, "").trim();
              if (desc.length > 0) description = desc;
            }
            
            events.push({
              title,
              startAt,
              sourceUrl: url.startsWith("http") ? url : new URL(url, base).href,
              locationName: "Manny's",
              description,
              tags: ["talk", "community"],
            });
          }
        }
      } catch {
        // Skip invalid JSON
      }
    });

    // Fallback: look for event links in the DOM
    if (events.length === 0) {
      $("a[href*='/e/']").each((_, el) => {
        const $a = $(el);
        const href = $a.attr("href");
        if (!href || !href.includes("eventbrite.com/e/") || seenUrls.has(href)) return;
        seenUrls.add(href);
        
        const title = $a.find("h3, h2, [data-testid*='title']").first().text().trim() || 
                     $a.text().trim().split("\n")[0]?.trim();
        if (!title || title.length < 2) return;

        const $card = $a.closest("article, [class*='event'], [data-testid*='event']").length
          ? $a.closest("article, [class*='event'], [data-testid*='event']")
          : $a.parent();
        const text = $card.text();
        
        // Try to find date in text
        const dateMatch = text.match(/([A-Za-z]{3})\s+(\d{1,2}),?\s*(\d{4})/);
        if (!dateMatch) return;
        
        const months: Record<string, number> = {
          Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
          Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
        };
        const month = months[dateMatch[1]];
        if (month === undefined) return;
        const day = parseInt(dateMatch[2], 10);
        const year = parseInt(dateMatch[3], 10);
        const startAt = new Date(year, month, day, 19, 0, 0).toISOString();

        const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
        events.push({
          title,
          startAt,
          sourceUrl: fullUrl,
          locationName: "Manny's",
          tags: ["talk", "community"],
        });
      });
    }

    return events;
  },
};
