import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { folsom1015Scraper } from "./1015folsom";

const FIXTURE_HTML = readFileSync(
  join(__dirname, "1015folsom-fixture.html"),
  "utf-8"
);

describe("1015 Folsom scraper", () => {
  it("parses fixture and shows sample event formatting", () => {
    const events = folsom1015Scraper.parse(FIXTURE_HTML);
    expect(events.length).toBe(3);

    const samples = events.slice(0, 5);
    // eslint-disable-next-line no-console
    console.log("\n--- 1015 Folsom sample events ---\n");
    samples.forEach((e, i) => {
      const date = typeof e.startAt === "string" ? e.startAt.slice(0, 10) : (e.startAt as Date).toISOString().slice(0, 10);
      // eslint-disable-next-line no-console
      console.log(`${i + 1}. ${date}  ${e.title}`);
      // eslint-disable-next-line no-console
      console.log(`   Location: ${e.locationName ?? "(none)"}`);
      // eslint-disable-next-line no-console
      console.log(`   URL: ${e.sourceUrl}`);
      // eslint-disable-next-line no-console
      console.log(`   Tags: ${(e.tags ?? []).join(", ")}\n`);
    });
    // eslint-disable-next-line no-console
    console.log(`Total events: ${events.length}\n`);

    const first = events[0]!;
    expect(first.title).toBe("Frnds Only Super Sunday w/ Leon Thomas");
    expect(events[1]!.title).toBe("DJ Lex (Low Ticket Warning)");
    expect(first.locationName).toBe("1015 Folsom");
    expect(first.sourceUrl).toBe("https://posh.vip/e/frnds-only-super-bowl-after-party?t=1015");
    expect(first.tags).toContain("concert");
  });
});
