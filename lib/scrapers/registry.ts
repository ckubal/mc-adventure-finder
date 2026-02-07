import type { Scraper } from "./types";

const scrapers: Scraper[] = [];

export function registerScraper(scraper: Scraper): void {
  if (scrapers.some((s) => s.id === scraper.id)) return;
  scrapers.push(scraper);
}

export function getScrapers(): Scraper[] {
  return [...scrapers];
}

export function getScraperById(id: string): Scraper | undefined {
  return scrapers.find((s) => s.id === id);
}
