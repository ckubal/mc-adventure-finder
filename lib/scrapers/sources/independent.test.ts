import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { independentScraper } from "./independent";

const FIXTURE_PATH = join(__dirname, "../fixtures/independent/calendar.html");

describe("independent scraper", () => {
  it("parses fixture and returns expected count and events", async () => {
    const html = readFileSync(FIXTURE_PATH, "utf-8");
    const events = await independentScraper.parse(html);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const bandEvent = events.find((e) => e.title.includes("Band Name"));
    expect(bandEvent).toBeDefined();
    expect(bandEvent!.sourceUrl).toContain("theindependentsf.com");
    expect(bandEvent!.startAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(bandEvent!.locationName).toBe("The Independent");
  });
});
