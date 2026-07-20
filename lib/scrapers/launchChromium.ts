/**
 * Shared Playwright Chromium launch tuned for small Render instances (~512MB).
 * Never launch more than one browser at a time — Chromium alone can use 200–400MB.
 */
export async function launchChromium() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= "0";
  const { chromium } = await import("playwright");
  return chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--mute-audio",
      "--no-first-run",
      "--hide-scrollbars",
      "--metrics-recording-only",
      "--disable-software-rasterizer",
      // Cap renderer process count / memory pressure on tiny instances
      "--renderer-process-limit=1",
      "--js-flags=--max-old-space-size=128",
    ],
  });
}
