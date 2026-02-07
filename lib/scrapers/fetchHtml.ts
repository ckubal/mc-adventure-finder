const DEFAULT_TIMEOUT_MS = 15_000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Fetch HTML from a URL with a simple user-agent.
 * Use in scrapers' fetch().
 */
export async function fetchHtml(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const { html } = await fetchHtmlWithUrl(url, timeoutMs);
  return html;
}

/**
 * Fetch HTML and return the final URL after redirects (e.g. to detect Ticketweb).
 */
export async function fetchHtmlWithUrl(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${url}`);
    }
    const html = await res.text();
    const finalUrl = res.url || url;
    return { html, finalUrl };
  } finally {
    clearTimeout(timeoutId);
  }
}
