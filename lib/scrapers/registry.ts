import type { Scraper } from "./types";

const scrapers: Scraper[] = [];

export function registerScraper(scraper: Scraper): void {
  scrapers.push(scraper);
}

export function getScrapers(): Scraper[] {
  return [...scrapers];
}

export function getScraperById(id: string): Scraper | undefined {
  return scrapers.find((s) => s.id === id);
}
