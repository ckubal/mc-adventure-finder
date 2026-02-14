/**
 * Extract Event schema from JSON-LD in HTML (e.g. Ticketweb, schema.org Event).
 * Prefer canonical "name" or first performer "name" instead of UI text like "Sold Out".
 */

export interface JsonLdEvent {
  name?: string;
  startDate?: string;
  endDate?: string | null;
  description?: string;
  performers?: { name: string }[];
  location?: { name?: string; address?: { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string } };
  url?: string;
  "@type"?: string;
}

const EVENT_TYPES = new Set(["Event", "MusicEvent", "TheaterEvent"]);

function isEventLike(obj: unknown): obj is JsonLdEvent {
  if (obj == null || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  const type = o["@type"];
  if (typeof type === "string" && EVENT_TYPES.has(type)) return true;
  if (Array.isArray(type) && type.some((t) => EVENT_TYPES.has(String(t)))) return true;
  return !!(o.name && (typeof o.name === "string" || Array.isArray(o.performers)));
}

function findEventInValue(value: unknown): JsonLdEvent | null {
  if (isEventLike(value)) return value as JsonLdEvent;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEventInValue(item);
      if (found) return found;
    }
  }
  if (value != null && typeof value === "object" && "@graph" in value) {
    const graph = (value as { "@graph": unknown[] })["@graph"];
    if (Array.isArray(graph)) {
      for (const item of graph) {
        const found = findEventInValue(item);
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Parse HTML and return the first schema.org Event (or MusicEvent, etc.) from application/ld+json.
 */
export function extractJsonLdEvent(html: string): JsonLdEvent | null {
  const scriptMatch = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) return null;
  try {
    const json = JSON.parse(scriptMatch[1].trim());
    return findEventInValue(json);
  } catch {
    return null;
  }
}

/**
 * Title from JSON-LD: prefer event name, then first performer name.
 */
export function titleFromJsonLdEvent(ld: JsonLdEvent | null): string | null {
  if (!ld) return null;
  const name = ld.name && typeof ld.name === "string" ? ld.name.trim() : null;
  if (name && name.length > 1) return name;
  const firstPerformer = ld.performers?.[0]?.name?.trim();
  if (firstPerformer && firstPerformer.length > 1) return firstPerformer;
  return null;
}

/**
 * startDate from JSON-LD (ISO 8601 local or with offset).
 */
export function startDateFromJsonLdEvent(ld: JsonLdEvent | null): string | null {
  if (!ld?.startDate || typeof ld.startDate !== "string") return null;
  const s = ld.startDate.trim();
  if (!s) return null;
  // If the JSON-LD timestamp omits an offset (common on venue sites),
  // `new Date("YYYY-MM-DDTHH:mm")` will be interpreted in the server's TZ (Render=UTC),
  // shifting SF evening events earlier by ~8 hours. Assume LA for this app.
  try {
    // Lazy import to avoid cycles if this module is used in environments without Intl.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseIsoAssumingTimeZone } = require("./timezone") as typeof import("./timezone");
    return parseIsoAssumingTimeZone(s) ?? s;
  } catch {
    return s;
  }
}

/**
 * Extract a title from any JSON-LD on the page when there's no Event schema
 * (e.g. Yoast WebPage "name" or BreadcrumbList last item). Use for venue pages
 * that embed event info in WebPage name like "Grace Bowers | The Independent SF".
 */
export function extractFallbackTitleFromJsonLd(html: string): string | null {
  const scriptMatch = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) return null;
  try {
    const json = JSON.parse(scriptMatch[1].trim()) as Record<string, unknown>;
    const graph = json["@graph"] as unknown[] | undefined;
    if (!Array.isArray(graph)) return null;
    for (const item of graph) {
      const o = item as Record<string, unknown>;
      if (o["@type"] === "WebPage" && typeof o.name === "string") {
        const name = (o.name as string).trim();
        if (name.length > 2 && !/^(home|calendar|events?)$/i.test(name)) return name;
      }
      if (o["@type"] === "BreadcrumbList" && Array.isArray(o.itemListElement)) {
        const last = o.itemListElement[o.itemListElement.length - 1] as Record<string, unknown>;
        if (last && typeof last.name === "string") {
          const name = (last.name as string).trim();
          if (name.length > 2) return name;
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}
