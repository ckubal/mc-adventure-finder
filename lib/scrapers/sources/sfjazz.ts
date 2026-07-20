import type { Scraper, RawEvent } from "../types";
import { parseIsoAssumingTimeZone } from "../timezone";

const BASE_URL = "https://www.sfjazz.org";
const CALENDAR_URL = `${BASE_URL}/calendar/`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * SFJazz's site is behind Cloudflare and its calendar is a JS app that loads events
 * from an internal JSON API (`/ace-api/events/?startDate=&endDate=`). The API 403s on
 * direct requests, but loading the calendar page in a real browser clears Cloudflare and
 * fires the API itself — so we drive the page and capture the API responses. We visit
 * three monthly anchors to cover ~90 days.
 */
type SfjazzApiEvent = {
  id?: string;
  name?: string;
  eventDate?: string;
  location?: string;
  synopsis?: string;
  viewDetailCtaUrl?: string;
  buyTicketCtaUrl?: string;
  isStreamingEvent?: boolean;
  hideFromCalendar?: boolean;
};

function monthAnchors(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 15);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15`);
  }
  return out;
}

export const sfjazzScraper: Scraper = {
  id: "sfjazz",
  name: "SFJazz",

  async fetch() {
    const { launchChromium } = await import("../launchChromium");
    const browser = await launchChromium();
    try {
      const page = await browser.newPage({ userAgent: UA });
      const byId = new Map<string, SfjazzApiEvent>();
      page.on("response", async (resp) => {
        if (!/\/ace-api\/events\/\?startDate=/i.test(resp.url()) || resp.status() !== 200) return;
        try {
          const arr = JSON.parse(await resp.text());
          if (Array.isArray(arr)) {
            for (const e of arr as SfjazzApiEvent[]) if (e?.id) byId.set(e.id, e);
          }
        } catch {
          // ignore non-JSON
        }
      });

      const anchors = monthAnchors(3);
      for (let i = 0; i < anchors.length; i++) {
        await page.goto(`${CALENDAR_URL}?date=${anchors[i]}&layout=A`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        // First visit may show Cloudflare's "Just a moment…" interstitial; wait it out.
        for (let t = 0; t < 8; t++) {
          await page.waitForTimeout(1500);
          const title = await page.title().catch(() => "");
          if (title && !/just a moment/i.test(title)) break;
        }
        // Give the calendar's API call time to fire and resolve.
        await page.waitForTimeout(2500);
      }

      return JSON.stringify([...byId.values()]);
    } finally {
      await browser.close().catch(() => undefined);
    }
  },

  parse(json: string): RawEvent[] {
    let items: SfjazzApiEvent[] = [];
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      return [];
    }

    // One entry per show per day (SFJazz often lists 6PM + 8:30PM as separate rows).
    const seen = new Set<string>();
    const events: RawEvent[] = [];

    for (const e of items) {
      if (!e.name || !e.eventDate) continue;
      if (e.hideFromCalendar) continue;
      if (e.isStreamingEvent) continue; // "SFJAZZ At Home" digital events — not in-person

      const startAt = parseIsoAssumingTimeZone(e.eventDate);
      if (!startAt) continue;

      const dayKey = `${e.name}|${startAt.slice(0, 10)}`;
      if (seen.has(dayKey)) continue;
      seen.add(dayKey);

      const rel = e.viewDetailCtaUrl || e.buyTicketCtaUrl || "";
      const sourceUrl = rel ? (rel.startsWith("http") ? rel : `${BASE_URL}${rel}`) : CALENDAR_URL;
      const description = e.synopsis ? e.synopsis.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : null;

      events.push({
        title: e.name.replace(/\s+/g, " ").trim(),
        startAt,
        sourceUrl,
        sourceEventId: `sfjazz-${dayKey}`,
        locationName: e.location ? `SFJazz Center — ${e.location}` : "SFJazz Center",
        description: description || null,
        tags: ["jazz", "music"],
      });
    }

    return events;
  },
};
