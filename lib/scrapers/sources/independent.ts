import type { Scraper, RawEvent } from "../types";
import { isoFromZonedParts } from "../timezone";

const BASE_URL = "https://www.theindependentsf.com";
const CALENDAR_URL = `${BASE_URL}/calendar/`;
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;

/** How many days ahead to request from the calendar API (runScrapers applies the real cutoff). */
const WINDOW_DAYS = 100;

/**
 * The Independent's calendar is a FullCalendar widget backed by a WordPress AJAX endpoint
 * (`admin-ajax.php?action=get_events_for_calendar`) that returns clean JSON for a date range.
 * Rather than scrape rendered tiles one month at a time (slow + flaky on headless Render), we
 * load the calendar once to capture the widget's own request (nonce + params), then replay it
 * for the full window in a single call — every event, fast.
 */
type IndCalEvent = {
  id?: number | string;
  start?: string;
  title?: string;
  doors?: string;
  url?: string;
  displayTime?: string;
  sortkey?: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date as "YYYY-M-D HH:MM:SS" in local server terms (matches the widget's request). */
function fmt(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** sortkey is "2026-07-10 21:00:00" in America/Los_Angeles; fall back to the date + 8pm. */
function startFromEvent(e: IndCalEvent): string | null {
  const raw = e.sortkey || (e.start ? `${e.start} 20:00:00` : "");
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return isoFromZonedParts({
    year: +m[1],
    month: +m[2],
    day: +m[3],
    hour: +m[4],
    minute: +m[5],
    second: +(m[6] || 0),
  });
}

export const independentScraper: Scraper = {
  id: "independent",
  name: "The Independent",

  async fetch() {
    process.env.PLAYWRIGHT_BROWSERS_PATH ||= "0";
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let widgetPost: string | null = null;
      page.on("request", (req) => {
        if (
          !widgetPost &&
          /admin-ajax\.php/i.test(req.url()) &&
          req.method() === "POST" &&
          /get_events_for_calendar/.test(req.postData() || "")
        ) {
          widgetPost = req.postData();
        }
      });

      await page.goto(CALENDAR_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Wait for the widget to fire its own AJAX (gives us the current nonce + params).
      for (let i = 0; i < 12 && !widgetPost; i++) await page.waitForTimeout(1000);
      if (!widgetPost) throw new Error("Independent: never captured get_events_for_calendar request");

      const now = new Date();
      const end = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const startStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} 00:00:00`;
      const body = (widgetPost as string)
        .replace(/start=[^&]*/, `start=${encodeURIComponent(startStr)}`)
        .replace(/end=[^&]*/, `end=${encodeURIComponent(fmt(end).replace(/ .*$/, " 23:59:59"))}`);

      const res = await page.evaluate(
        async ({ url, b }) => {
          const r = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: b,
          });
          return { status: r.status, text: await r.text() };
        },
        { url: AJAX_URL, b: body }
      );

      if (res.status !== 200) throw new Error(`Independent AJAX HTTP ${res.status}`);
      return res.text;
    } finally {
      await browser.close();
    }
  },

  parse(json: string): RawEvent[] {
    let items: IndCalEvent[] = [];
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) items = parsed;
      else if (parsed && Array.isArray(parsed.events)) items = parsed.events;
    } catch {
      return [];
    }

    const seen = new Set<string>();
    const events: RawEvent[] = [];

    for (const e of items) {
      const title = (e.title || "").replace(/\s+/g, " ").trim();
      if (!title) continue;
      const startAt = startFromEvent(e);
      if (!startAt) continue;

      const eventId = e.id != null ? `ind-${e.id}` : `ind-${title}-${e.start ?? ""}`;
      if (seen.has(eventId)) continue;
      seen.add(eventId);

      events.push({
        title,
        startAt,
        sourceUrl: CALENDAR_URL,
        sourceEventId: eventId,
        locationName: "The Independent",
        tags: ["concert"],
      });
    }

    return events;
  },
};
