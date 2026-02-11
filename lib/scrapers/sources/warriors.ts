import type { Scraper, RawEvent } from "../types";
import { getScrapeCutoffDate } from "../scrapeWindow";

const TEAM_ID = "9"; // ESPN Warriors
const SCHEDULE_URL = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${TEAM_ID}/schedule`;

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

export const warriorsScraper: Scraper = {
  id: "warriors",
  name: "Golden State Warriors (Home)",

  async fetch() {
    const json = await fetchJson<any>(SCHEDULE_URL);
    return JSON.stringify(json);
  },

  parse(jsonText: string): RawEvent[] {
    let payload: any;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return [];
    }
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const cutoff = getScrapeCutoffDate();
    const now = new Date();

    const out: RawEvent[] = [];
    for (const ev of events) {
      const competition = ev?.competitions?.[0];
      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
      const home = competitors.find((c: any) => c?.homeAway === "home");
      const away = competitors.find((c: any) => c?.homeAway === "away");
      const isWarriorsHome = home?.team?.id === TEAM_ID;
      if (!isWarriorsHome) continue;

      const startRaw = String(ev?.date ?? "").trim();
      const start = startRaw ? new Date(startRaw) : null;
      if (!start || Number.isNaN(start.getTime())) continue;
      if (start < now || start > cutoff) continue;

      const opponent = String(away?.team?.displayName ?? away?.team?.name ?? "").trim();
      const title =
        opponent.length > 0 ? `Golden State Warriors vs. ${opponent}` : String(ev?.name ?? "Warriors Game").trim();

      const url = String(ev?.links?.[0]?.href ?? "").trim() || SCHEDULE_URL;
      const venueName = String(competition?.venue?.fullName ?? "Chase Center").trim();
      const city = String(competition?.venue?.address?.city ?? "San Francisco").trim();
      const state = String(competition?.venue?.address?.state ?? "CA").trim();
      const locationAddress = [city, state].filter(Boolean).join(", ") || null;

      out.push({
        title,
        startAt: start.toISOString(),
        sourceUrl: url,
        sourceEventId: String(ev?.id ?? competition?.id ?? url),
        locationName: venueName,
        locationAddress: locationAddress,
        tags: ["sports", "basketball"],
        raw: {
          provider: "espn",
          espnId: ev?.id ?? null,
        },
      });
    }
    return out;
  },
};

