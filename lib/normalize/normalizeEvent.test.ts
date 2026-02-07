import { describe, it, expect } from "vitest";
import {
  normalizeEvent,
  eventIdFromSource,
} from "./normalizeEvent";
import type { RawEvent } from "@/lib/scrapers/types";

describe("normalizeEvent", () => {
  it("parses startAt and sets endAt to null when missing", () => {
    const raw: RawEvent = {
      title: "  Test Reading  ",
      startAt: "2026-02-01T19:00:00-08:00",
      sourceUrl: "https://booksmith.com/events/123",
    };
    const out = normalizeEvent(raw, "booksmith", "The Booksmith", "booksmith_abc");
    expect(out.title).toBe("Test Reading");
    expect(out.startAt).toBeInstanceOf(Date);
    expect(out.startAt.getFullYear()).toBe(2026);
    expect(out.startAt.getMonth()).toBe(1);
    expect(out.startAt.getDate()).toBe(1);
    expect(out.endAt).toBeNull();
    expect(out.locationName).toBe("The Booksmith");
    expect(out.locationAddress).toBeNull();
  });

  it("uses location from raw when present", () => {
    const raw: RawEvent = {
      title: "Concert",
      startAt: "2026-02-05T20:00:00-08:00",
      endAt: "2026-02-05T22:00:00-08:00",
      locationName: "The Independent",
      locationAddress: "628 Divisadero, San Francisco",
      sourceUrl: "https://theindependentsf.com/event/1",
    };
    const out = normalizeEvent(raw, "independent", "The Independent SF", "independent_xyz");
    expect(out.locationName).toBe("The Independent");
    expect(out.locationAddress).toBe("628 Divisadero, San Francisco");
    expect(out.endAt).toBeInstanceOf(Date);
    expect(out.endAt!.getTime()).toBe(new Date("2026-02-05T22:00:00-08:00").getTime());
  });

  it("trims title and sourceUrl", () => {
    const raw: RawEvent = {
      title: "  Spaces  ",
      startAt: "2026-03-01T18:00:00",
      sourceUrl: "  https://example.com/event  ",
    };
    const out = normalizeEvent(raw, "ex", "Example", "ex_1");
    expect(out.title).toBe("Spaces");
    expect(out.sourceUrl).toBe("https://example.com/event");
  });
});

describe("eventIdFromSource", () => {
  it("produces stable id from sourceId and sourceUrl", () => {
    const a = eventIdFromSource("booksmith", "https://booksmith.com/events/123");
    const b = eventIdFromSource("booksmith", "https://booksmith.com/events/123");
    expect(a).toBe(b);
  });

  it("produces different ids for different urls", () => {
    const a = eventIdFromSource("booksmith", "https://booksmith.com/events/123");
    const b = eventIdFromSource("booksmith", "https://booksmith.com/events/456");
    expect(a).not.toBe(b);
  });

  it("uses sourceEventId when provided", () => {
    const a = eventIdFromSource("booksmith", "https://booksmith.com/events/123", "evt-123");
    const b = eventIdFromSource("booksmith", "https://booksmith.com/events/456", "evt-123");
    expect(a).toBe(b);
  });
});
