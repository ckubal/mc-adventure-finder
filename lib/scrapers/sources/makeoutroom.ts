import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Scraper, RawEvent } from "../types";
import { fetchHtml, fetchHtmlWithUrl } from "../fetchHtml";
import { extractJsonLdEvent } from "../jsonLdEvent";

const BASE_URL = "http://www.makeoutroom.com";
const EVENTS_URL = `${BASE_URL}/events`;

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

export const makeOutRoomScraper: Scraper = {
  id: "makeoutroom",
  name: "Make-Out Room",

  async fetch() {
    return fetchHtml(EVENTS_URL);
  },

  async parse(html: string): Promise<RawEvent[]> {
    const $ = cheerio.load(html);
    const events: RawEvent[] = [];
    const base = new URL(EVENTS_URL);

    // Make-Out Room uses .blog-post containers on the listing page.
    $(".blog-post").each((_, el) => {
      const $post = $(el);
      const $a = $post.find("a.blog-title-link").first();
      if (!$a.length) return;
      
      const href = $a.attr("href");
      if (!href || (!href.includes("/events/") && !href.includes("makeoutroom.com/events"))) return;
      
      const title = $a.text().trim();
      if (!title || title.length < 2) return;
      
      // Date is in .blog-date .date-text (e.g. "2/14/2026")
      const dateText = $post.find(".blog-date .date-text").first().text().trim();
      if (!dateText) return;
      
      // Parse "2/14/2026" format
      const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!dateMatch) return;
      const month = parseInt(dateMatch[1], 10) - 1;
      const day = parseInt(dateMatch[2], 10);
      const year = parseInt(dateMatch[3], 10);
      if (!year || !day) return;
      
      const fullUrl = href.startsWith("http") ? href : new URL(href.replace(/^\/\//, "http://"), base).href;
      
      // Fetch detail page to extract multiple events (store date in raw for detail parsing)
      events.push({
        title,
        startAt: "", // Will be set after parsing detail page
        sourceUrl: fullUrl,
        locationName: "Make-Out Room",
        tags: ["concert"],
        raw: { _detailDate: { year, month, day } },
      });
    });

    // Parse detail pages to extract multiple events per page
    const detailEvents: RawEvent[] = [];
    for (let i = 0; i < events.length; i += CONCURRENCY) {
      const chunk = events.slice(i, i + CONCURRENCY);
      const parsed = await Promise.all(
        chunk.map(async (event) => {
          try {
            const { html: detailHtml } = await fetchHtmlWithUrl(event.sourceUrl, DETAIL_FETCH_TIMEOUT_MS);
            const $detail = cheerio.load(detailHtml);
            const pageEvents: RawEvent[] = [];
            
            // Extract date from stored date or from URL/page title
            const dateInfo = (event.raw as { _detailDate?: { year: number; month: number; day: number } })?._detailDate;
            if (!dateInfo) return [];
            
            // Split content by horizontal rules to find separate events
            const content = $detail("#wsite-content, .blog-post-content, .blog-post").first();
            const sections: cheerio.Cheerio<AnyNode>[] = [];
            let currentSection: AnyNode[] = [];
            
            content.children().each((_, child) => {
              const $child = $detail(child);
              if ($child.is("hr.styled-hr, hr")) {
                if (currentSection.length > 0) {
                  sections.push($detail(currentSection));
                  currentSection = [];
                }
              } else {
                currentSection.push(child);
              }
            });
            if (currentSection.length > 0) {
              sections.push($detail(currentSection));
            }
            
            // If no sections found, treat entire content as one event
            if (sections.length === 0) {
              sections.push(content);
            }

            // If we have only one section but content has multiple times (e.g. "8:00pm ... 9:30pm ..."), split by time to get multiple events
            if (sections.length === 1) {
              const fullText = content.text();
              const timeSplitRegex = /\s+(?=\d{1,2}(?::\d{2})?\s*[ap]m\b)/gi;
              const parts = fullText.split(timeSplitRegex).map((p) => p.trim()).filter((p) => p.length > 15);
              if (parts.length > 1) {
                sections.length = 0;
                parts.forEach((part) => {
                  const $fake = cheerio.load(`<div>${part.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`);
                  sections.push($fake("div"));
                });
              }
            }

            // Parse each section as a potential event
            sections.forEach((section, idx) => {
              const text = section.text().trim();
              if (!text || text.length < 10) return;
              
              // Look for event title - usually bold text at the start, often followed by ~
              let title = "";
              const $strong = section.find("strong").first();
              if ($strong.length) {
                let strongText = $strong.text().trim();
                // Handle cases like "BOOM!" or "ABOUT LAST NIGHT:" followed by newline and subtitle
                const strongLines = strongText.split("\n").map(l => l.trim()).filter(Boolean);
                if (strongLines.length > 0) {
                  // Take first line as main title, or combine if short
                  title = strongLines[0];
                  // If second line looks like a subtitle (starts with "A" or "An" or is italic), include it
                  if (strongLines.length > 1 && strongLines[1].match(/^(A|An|The)\s+[A-Z]/)) {
                    title = `${title}: ${strongLines[1]}`;
                  }
                } else {
                  title = strongText;
                }
                // Clean up title - remove leading/trailing ~ and whitespace
                title = title.replace(/^~+\s*/, "").replace(/\s*~+$/, "").trim();
              }
              
              // Fallback: extract from first paragraph or first line
              if (!title || title.length < 2) {
                const $firstPara = section.find("p, .paragraph, div.paragraph").first();
                if ($firstPara.length) {
                  const paraText = $firstPara.text().trim();
                  const firstLine = paraText.split("\n")[0]?.trim() || paraText.split("~")[0]?.trim();
                  if (firstLine && firstLine.length > 2 && firstLine.length < 100) {
                    title = firstLine.replace(/^~+\s*/, "").replace(/\s*~+$/, "").trim();
                  }
                } else {
                  const firstLine = text.split("\n")[0]?.trim() || text.split("~")[0]?.trim();
                  if (firstLine && firstLine.length > 2 && firstLine.length < 100) {
                    title = firstLine.replace(/^~+\s*/, "").replace(/\s*~+$/, "").trim();
                  }
                }
              }
              
              // Clean up title - remove leading/trailing punctuation
              title = title.replace(/^[:\-~]+\s*/, "").replace(/\s*[:\-~]+$/, "").trim();
              // If parsed title looks like a date (e.g. "Saturday, February 7") or just a time ("8:00pm"), use listing title
              if (event.title && (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s+[A-Za-z]+\s+\d{1,2}$/i.test(title.trim()) || /^\d{1,2}(?::\d{2})?\s*[ap]m$/i.test(title.trim()))) {
                title = event.title;
              }
              if (!title || title.length < 2) return;
              
              // Extract time from text (e.g. "10:00pm - 2:00am" or "7:00pm - 9:30pm")
              let startTime = "8:00pm";
              let endTime: string | null = null;
              const timeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)\s*-\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
              if (timeMatch) {
                startTime = timeMatch[1].trim();
                endTime = timeMatch[2].trim();
              } else {
                const singleTimeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
                if (singleTimeMatch) {
                  startTime = singleTimeMatch[1].trim();
                }
              }
              
              // Parse time
              const timeParts = startTime.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);
              if (!timeParts) return;
              let hours = parseInt(timeParts[1], 10);
              const minutes = timeParts[2] ? parseInt(timeParts[2], 10) : 0;
              if (timeParts[3].toLowerCase() === "pm" && hours < 12) hours += 12;
              if (timeParts[3].toLowerCase() === "am" && hours === 12) hours = 0;
              
              const startAt = new Date(dateInfo.year, dateInfo.month, dateInfo.day, hours, minutes, 0).toISOString();
              
              // Extract description
              let description: string | null = null;
              const descText = section.text().trim();
              // Remove title and time info to get description
              const descClean = descText
                .replace(new RegExp(`^.*?${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*?~`, "i"), "")
                .replace(/~\s*$/, "")
                .trim();
              if (descClean && descClean.length > 20 && descClean.length < 500) {
                description = descClean.slice(0, 300);
              }
              
              pageEvents.push({
                title,
                startAt,
                sourceUrl: event.sourceUrl,
                locationName: "Make-Out Room",
                description,
                tags: ["concert"],
              });
            });
            
            return pageEvents.length > 0 ? pageEvents : [{
              ...event,
              startAt: new Date(dateInfo.year, dateInfo.month, dateInfo.day, 20, 0, 0).toISOString(),
            }]; // Fallback to original event if no sub-events found
          } catch {
            // If detail page parsing fails, use the original event with default time
            const dateInfo = (event.raw as { _detailDate?: { year: number; month: number; day: number } })?._detailDate;
            if (dateInfo) {
              return [{
                ...event,
                startAt: new Date(dateInfo.year, dateInfo.month, dateInfo.day, 20, 0, 0).toISOString(),
              }];
            }
            return [];
          }
        })
      );
      detailEvents.push(...parsed.flat());
    }
    
    return detailEvents;
  },
};
