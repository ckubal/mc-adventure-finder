import type { Scraper, RawEvent } from "../types";
import { fetchHtml } from "../fetchHtml";

const EVENTS_URL = "https://www.thefaight.com/events";

/**
 * The Faight is a Next.js/Sanity site that embeds its full event list as JSON in the page
 * (the Next.js "flight" payload). That data is the source of truth: it includes events that
 * aren't ticketed through Eventbrite (open mics, gallery nights, takeovers) and the correct
 * upcoming date for recurring events — both of which a previous Eventbrite-link scraper missed.
 * We reconstruct the embedded JSON and read the event objects directly.
 */
type PortableChild = { text?: string };
type PortableBlock = { children?: PortableChild[] };
type FaightEvent = {
  _id?: string;
  title?: string;
  slug?: { current?: string };
  startTime?: string;
  endTime?: string;
  ctaUrl?: string;
  description?: PortableBlock[] | string | null;
  space?: string | null;
  isPrivate?: boolean;
};

/** Concatenate and unescape the Next.js flight payload chunks into one JSON-ish string. */
function unescapeFlightData(html: string): string {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse(`"${m[1]}"`);
    } catch {
      // skip malformed chunk
    }
  }
  return out;
}

/** Pull out every JSON object that has a startTime field, via brace matching. */
function extractEventObjects(text: string): FaightEvent[] {
  const events: FaightEvent[] = [];
  const marker = '"startTime":"';
  for (let idx = text.indexOf(marker); idx !== -1; idx = text.indexOf(marker, idx + 1)) {
    // Walk backward to the object's opening brace.
    let depth = 0;
    let start = -1;
    for (let p = idx; p >= 0; p--) {
      const ch = text[p];
      if (ch === "}") depth++;
      else if (ch === "{") {
        if (depth === 0) {
          start = p;
          break;
        }
        depth--;
      }
    }
    if (start === -1) continue;
    // Walk forward to the matching closing brace.
    let d = 0;
    let end = -1;
    for (let q = start; q < text.length; q++) {
      const ch = text[q];
      if (ch === "{") d++;
      else if (ch === "}") {
        d--;
        if (d === 0) {
          end = q + 1;
          break;
        }
      }
    }
    if (end === -1) continue;
    try {
      events.push(JSON.parse(text.slice(start, end)) as FaightEvent);
    } catch {
      // object contained an unescaped brace in free text — skip it
    }
  }
  return events;
}

function flattenDescription(desc: FaightEvent["description"]): string | null {
  if (!desc) return null;
  if (typeof desc === "string") return desc.trim() || null;
  const parts: string[] = [];
  for (const block of desc) {
    const text = (block.children ?? []).map((c) => c.text ?? "").join("");
    if (text.trim()) parts.push(text.trim());
  }
  const joined = parts.join("\n\n").trim();
  return joined || null;
}

/** Drop the venue tag the CMS titles sometimes carry ("… Live @ The Faight"). */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*(?:live\s+)?(?:@|at)\s+the faight/gi, " ")
    .replace(/\s*[|\-–—]\s*(?:live\s+)?the faight/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[\s|\-–—]+$/, "") // trailing separator left after stripping the venue tag
    .trim();
}

export const faightScraper: Scraper = {
  id: "faight",
  name: "The Faight",

  async fetch() {
    return fetchHtml(EVENTS_URL);
  },

  parse(html: string): RawEvent[] {
    const raw = extractEventObjects(unescapeFlightData(html));
    const seen = new Set<string>();
    const events: RawEvent[] = [];

    for (const e of raw) {
      if (!e.startTime || !e.title) continue;
      if (e.isPrivate) continue;

      const id = e._id || `${e.slug?.current ?? ""}-${e.startTime}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const start = new Date(e.startTime);
      if (Number.isNaN(start.getTime())) continue;

      const title = cleanTitle(e.title) || e.title.trim();
      const sourceUrl =
        e.ctaUrl && /^https?:\/\//.test(e.ctaUrl)
          ? e.ctaUrl
          : e.slug?.current
            ? `${EVENTS_URL}/${e.slug.current}`
            : EVENTS_URL;

      events.push({
        title,
        startAt: e.startTime,
        endAt: e.endTime && !Number.isNaN(new Date(e.endTime).getTime()) ? e.endTime : null,
        sourceUrl,
        sourceEventId: `faight-${id}`,
        locationName: "The Faight",
        locationAddress: "255 Fillmore St, San Francisco, CA",
        description: flattenDescription(e.description),
        tags: ["concert"],
      });
    }

    return events;
  },
};
