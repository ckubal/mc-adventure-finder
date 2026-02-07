/**
 * Fetch rendered HTML from a URL using Playwright (for JS-rendered pages).
 * Use in scrapers whose sites show "Loading…" in static HTML.
 */
export async function fetchWithPlaywright(url: string): Promise<string> {
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
