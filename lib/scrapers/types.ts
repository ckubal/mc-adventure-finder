/**
 * Raw event as returned by a scraper before normalization.
 * startAt/endAt can be ISO strings or Date; normalization converts to Date in America/Los_Angeles.
 */
export interface RawEvent {
  title: string;
  startAt: string | Date;
  endAt?: string | Date | null;
  locationName?: string | null;
  locationAddress?: string | null;
  sourceUrl: string;
  sourceEventId?: string;
  description?: string | null;
  tags?: string[];
  raw?: Record<string, unknown>;
}

/**
 * Normalized event ready for Firestore (startAt/endAt as Date in LA timezone).
 * id is set by the pipeline (sourceId + hash of sourceUrl or sourceEventId).
 */
export interface NormalizedEvent {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  locationName: string | null;
  locationAddress: string | null;
  description: string | null;
  tags: string[];
  raw?: Record<string, unknown>;
}

export interface Scraper {
  id: string;
  name: string;
  /** Fetch HTML (or multiple pages) for the source. */
  fetch(): Promise<string>;
  /** Parse HTML into raw events (pure, sync or async). */
  parse(html: string): RawEvent[] | Promise<RawEvent[]>;
}
