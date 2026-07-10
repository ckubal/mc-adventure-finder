import { describe, it, expect } from "vitest";
import { independentScraper } from "./independent";

// The Independent's calendar API returns { events: [...] } with these fields.
const SAMPLE = JSON.stringify({
  events: [
    {
      id: 2486,
      start: "2026-07-10",
      title: "Young Franco",
      allDay: "false",
      doors: "8:30 PM",
      url: "#tw-event-dialog-2486",
      displayTime: "9:00 PM",
      sortkey: "2026-07-10 21:00:00",
    },
    {
      id: 2667,
      start: "2026-07-11",
      title: "The Emo Night Tour",
      sortkey: "2026-07-11 21:00:00",
    },
    // Duplicate id — should be deduped.
    {
      id: 2486,
      start: "2026-07-10",
      title: "Young Franco",
      sortkey: "2026-07-10 21:00:00",
    },
    // Missing title — should be skipped.
    { id: 9999, start: "2026-07-12", sortkey: "2026-07-12 20:00:00" },
  ],
});

describe("independent scraper", () => {
  it("parses the calendar API JSON into events", async () => {
    const events = await independentScraper.parse(SAMPLE);
    expect(events.length).toBe(2);

    const band = events.find((e) => e.title.includes("Young Franco"));
    expect(band).toBeDefined();
    expect(band!.sourceUrl).toContain("theindependentsf.com");
    expect(band!.sourceEventId).toBe("ind-2486");
    expect(band!.locationName).toBe("The Independent");
    // sortkey 21:00 America/Los_Angeles (UTC-7 in July) -> 04:00Z next day.
    expect(band!.startAt).toBe("2026-07-11T04:00:00.000Z");
  });

  it("returns [] on non-JSON input", async () => {
    expect(await independentScraper.parse("<html>nope</html>")).toEqual([]);
  });
});
