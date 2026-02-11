import { getScrapeCutoffDate } from "./scrapeWindow";

const DEFAULT_TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface TicketmasterArtistEvent {
  title?: string;
  id?: string;
  discoveryId?: string;
  url?: string;
  timeZone?: string;
  dates?: {
    startDate?: string;
    onsaleDate?: string;
    spanMultipleDays?: boolean;
  };
  venue?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    addressLineOne?: string;
    code?: string;
  };
  artists?: Array<{ name?: string; url?: string }>;
  cancelled?: boolean;
  postponed?: boolean;
  rescheduled?: boolean;
  tba?: boolean;
}

export interface TicketmasterArtistSearchResponse {
  total?: number;
  events?: TicketmasterArtistEvent[];
}

async function fetchJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

function safeStartDate(ev: TicketmasterArtistEvent): Date | null {
  const raw = ev?.dates?.startDate;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function fetchTicketmasterArtistEvents(opts: {
  artistId: string;
  /** Query params to pass through (e.g. { home_away: "home" }) */
  query?: Record<string, string>;
  /** A normal Ticketmaster page URL to visit first if the API blocks server fetches (403). */
  warmUrl?: string;
  /** Stop when we go beyond this date (defaults to SCRAPE_WINDOW_DAYS cutoff) */
  cutoff?: Date;
  /** Safety limit */
  maxPages?: number;
  /** Per-request timeout */
  timeoutMs?: number;
  /** Filter events before returning */
  include?: (ev: TicketmasterArtistEvent) => boolean;
}): Promise<TicketmasterArtistEvent[]> {
  const cutoff = opts.cutoff ?? getScrapeCutoffDate();
  const now = new Date();
  const maxPages = opts.maxPages ?? 25;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const include = opts.include ?? (() => true);

  const all: TicketmasterArtistEvent[] = [];
  let shouldStop = false;

  // Some hosts/IPs (e.g. Render) get 403 from this endpoint. If that happens, fall back
  // to Playwright's browser context request API after visiting a warm URL.
  let usePlaywright = false;
  let pw: { browser: any; page: any } | null = null;

  const fetchViaPlaywright = async <T,>(url: string): Promise<T> => {
    if (!pw) {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        userAgent: UA,
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      const warmUrl = opts.warmUrl ?? "https://www.ticketmaster.com/";
      // Ticketmaster pages can keep network active; don't wait for networkidle.
      await page.goto(warmUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      pw = { browser, page };
    }
    const res = await pw.page.request.get(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: opts.warmUrl ?? "https://www.ticketmaster.com/",
      },
      timeout: timeoutMs,
    });
    if (!res.ok()) {
      throw new Error(`HTTP ${res.status()}: ${url}`);
    }
    return (await res.json()) as T;
  };

  try {
    for (let page = 0; page < maxPages; page++) {
    const u = new URL(`https://www.ticketmaster.com/api/search/events/artist/${opts.artistId}`);
    u.searchParams.set("page", String(page));
    // region=200 appears to be "United States" for TM US
    u.searchParams.set("region", "200");
    for (const [k, v] of Object.entries(opts.query ?? {})) u.searchParams.set(k, v);

      let json: TicketmasterArtistSearchResponse;
      try {
        json = usePlaywright
          ? await fetchViaPlaywright<TicketmasterArtistSearchResponse>(u.toString())
          : await fetchJson<TicketmasterArtistSearchResponse>(u.toString(), timeoutMs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!usePlaywright && msg.includes("HTTP 403") && page === 0) {
          usePlaywright = true;
          json = await fetchViaPlaywright<TicketmasterArtistSearchResponse>(u.toString());
        } else {
          throw e;
        }
      }

      const batch = Array.isArray(json.events) ? json.events : [];
      if (batch.length === 0) break;

      for (const ev of batch) {
        const start = safeStartDate(ev);
        if (!start) continue;
        if (start < now) continue;
        if (start > cutoff) {
          shouldStop = true;
          continue;
        }
        if (!include(ev)) continue;
        all.push(ev);
      }

      // Ticketmaster appears sorted chronologically; once we see anything beyond cutoff we can stop paging.
      if (shouldStop) break;
    }
  } finally {
    if (pw) {
      await pw.browser.close().catch(() => {});
      pw = null;
    }
  }

  // Stable sort by startDate just in case API changes ordering.
  all.sort((a, b) => (safeStartDate(a)?.getTime() ?? 0) - (safeStartDate(b)?.getTime() ?? 0));
  return all;
}

