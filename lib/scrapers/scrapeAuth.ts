import { NextRequest } from "next/server";

/**
 * Protects cron / automated scrape endpoints.
 * Set SCRAPE_SECRET in Render env; cron jobs pass Authorization: Bearer <secret>.
 */
export function isScrapeAuthorized(req: NextRequest): boolean {
  const secret = process.env.SCRAPE_SECRET?.trim();
  if (!secret) return true;

  const auth = req.headers.get("authorization")?.trim();
  if (auth === `Bearer ${secret}`) return true;

  const querySecret = new URL(req.url ?? "/", "http://localhost").searchParams.get("secret")?.trim();
  return querySecret === secret;
}
