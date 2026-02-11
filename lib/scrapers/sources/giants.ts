import type { Scraper, RawEvent } from "../types";
import { getScrapeCutoffDate } from "../scrapeWindow";

const TEAM_ID = 137; // MLB Giants
const ORACLE_PARK_ID = 2395;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const giantsScraper: Scraper = {
  id: "giants",
  name: "SF Giants (Oracle Park)",

  async fetch() {
    const now = new Date();
    const cutoff = getScrapeCutoffDate();
    const url = new URL("https://statsapi.mlb.com/api/v1/schedule");
    url.searchParams.set("sportId", "1");
    url.searchParams.set("teamId", String(TEAM_ID));
    url.searchParams.set("startDate", ymd(now));
    url.searchParams.set("endDate", ymd(cutoff));
    url.searchParams.set("hydrate", "venue,teams");
    const json = await fetchJson<any>(url.toString());
    return JSON.stringify(json);
  },

  parse(jsonText: string): RawEvent[] {
    let payload: any;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return [];
    }
    const dates = Array.isArray(payload?.dates) ? payload.dates : [];
    const now = new Date();
    const cutoff = getScrapeCutoffDate();

    const out: RawEvent[] = [];
    for (const day of dates) {
      const games = Array.isArray(day?.games) ? day.games : [];
      for (const g of games) {
        const startRaw = String(g?.gameDate ?? "").trim();
        const start = startRaw ? new Date(startRaw) : null;
        if (!start || Number.isNaN(start.getTime())) continue;
        if (start < now || start > cutoff) continue;

        const venueId = g?.venue?.id;
        const venueName = String(g?.venue?.name ?? "").trim();
        const isOracle = venueId === ORACLE_PARK_ID || /oracle park/i.test(venueName);
        if (!isOracle) continue;

        const homeId = g?.teams?.home?.team?.id;
        if (homeId !== TEAM_ID) continue;

        const awayName = String(g?.teams?.away?.team?.name ?? "").trim();
        const title = awayName ? `San Francisco Giants vs. ${awayName}` : "San Francisco Giants Game";
        const gamePk = String(g?.gamePk ?? "").trim();
        const url = gamePk ? `https://www.mlb.com/gameday/${gamePk}` : "https://www.mlb.com/giants/schedule";

        out.push({
          title,
          startAt: start.toISOString(),
          sourceUrl: url,
          sourceEventId: gamePk || url,
          locationName: "Oracle Park",
          locationAddress: "24 Willie Mays Plaza, San Francisco, CA",
          tags: ["sports", "baseball"],
          raw: {
            provider: "mlb",
            gamePk: g?.gamePk ?? null,
            venueId: venueId ?? null,
          },
        });
      }
    }
    return out;
  },
};

