/**
 * Fetch rendered HTML from a URL using Playwright (for JS-rendered pages).
 * Use in scrapers whose sites show "Loading…" in static HTML.
 */
export async function fetchWithPlaywright(url: string): Promise<string> {
  // Ensure Playwright looks for browsers bundled with the app (not ephemeral OS cache).
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= "0";
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

/** Fetch rendered HTML and wait for a selector (e.g. JS-loaded calendars). */
export async function fetchWithPlaywrightWait(
  url: string,
  selector: string,
  timeoutMs = 45_000
): Promise<string> {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= "0";
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // attached, not visible — calendar nodes are often in DOM but off-screen/hidden on headless Render.
    await page.waitForSelector(selector, { timeout: timeoutMs, state: "attached" });
    await page.waitForTimeout(1500);
    return await page.content();
  } finally {
    await browser.close();
  }
}

/**
 * Fetch a JS calendar (e.g. FullCalendar) and advance through several months,
 * accumulating each month's rendered HTML. Returns the concatenated HTML so a
 * cheerio parser sees every month's events (parsers should dedupe by URL).
 * Used for venues whose calendar only renders the current month at a time.
 */
export async function fetchCalendarMonths(
  url: string,
  waitSelector: string,
  nextButtonSelector: string,
  months = 3,
  timeoutMs = 45_000
): Promise<string> {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= "0";
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForSelector(waitSelector, { timeout: timeoutMs, state: "attached" });
    await page.waitForTimeout(1500);

    const chunks: string[] = [await page.content()];
    for (let i = 1; i < months; i++) {
      const next = page.locator(nextButtonSelector).first();
      if (!(await next.count())) break;
      try {
        await next.click({ timeout: 5000 });
      } catch {
        break;
      }
      // Let the month's AJAX fetch settle and re-render (slower on headless Render).
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2500);
      chunks.push(await page.content());
    }
    return chunks.join("\n<!-- month-break -->\n");
  } finally {
    await browser.close();
  }
}

/**
 * Fetch rendered HTML and attempt to auto-scroll to load more content.
 * Useful for infinite-scroll event listings (e.g. Eventbrite organizer pages).
 */
export async function fetchWithPlaywrightAutoScroll(
  url: string,
  opts?: {
    timeoutMs?: number;
    maxScrolls?: number;
    scrollWaitMs?: number;
    /**
     * If provided, we will stop scrolling once this selector's count stops increasing.
     * If omitted, we use document height changes as a weaker signal.
     */
    stabilizeSelector?: string;
    /** Best-effort click a button whose accessible name matches /Upcoming/i. */
    clickUpcomingTab?: boolean;
  }
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const maxScrolls = opts?.maxScrolls ?? 10;
  const scrollWaitMs = opts?.scrollWaitMs ?? 1200;
  const stabilizeSelector = opts?.stabilizeSelector;

  // Ensure Playwright looks for browsers bundled with the app (not ephemeral OS cache).
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= "0";
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });

    if (opts?.clickUpcomingTab) {
      try {
        const btn = page.getByRole("button", { name: /upcoming/i }).first();
        if (await btn.count()) {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
        }
      } catch {
        // ignore
      }
    }

    let stableRounds = 0;
    let prevCount = -1;
    let prevHeight = -1;

    for (let i = 0; i < maxScrolls; i++) {
      let curCount = prevCount;
      if (stabilizeSelector) {
        try {
          curCount = await page.locator(stabilizeSelector).count();
        } catch {
          curCount = prevCount;
        }
      }

      const curHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(scrollWaitMs);

      if (stabilizeSelector) {
        const nextCount = await page.locator(stabilizeSelector).count().catch(() => curCount);
        if (nextCount === curCount) stableRounds++;
        else stableRounds = 0;
        prevCount = nextCount;
      } else {
        const nextHeight = await page.evaluate(() => document.body.scrollHeight);
        if (nextHeight === curHeight) stableRounds++;
        else stableRounds = 0;
        prevHeight = nextHeight;
      }

      if (stableRounds >= 2) break;
      prevHeight = curHeight;
    }

    return await page.content();
  } finally {
    await browser.close();
  }
}
