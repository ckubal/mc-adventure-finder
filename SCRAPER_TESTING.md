# Testing Scrapers

When adding new scrapers, use the test endpoint to preview sample events and verify they're extracting data correctly.

## Test Endpoint

**GET** `/api/scrape/test?sourceId=<scraper-id>&limit=<number>`

### Parameters:
- `sourceId` (required): The scraper ID (e.g., `funcheap`, `bottomofthehill`, `independent`)
- `limit` (optional): Number of sample events to return (default: 5)

### Example:

```bash
# Test Funcheap scraper
curl "http://localhost:3000/api/scrape/test?sourceId=funcheap&limit=3"

# Test Bottom of the Hill scraper
curl "http://localhost:3000/api/scrape/test?sourceId=bottomofthehill&limit=3"
```

### Response Format:

```json
{
  "sourceId": "funcheap",
  "sourceName": "Funcheap SF",
  "totalFound": 45,
  "samples": [
    {
      "raw": {
        "title": "Event Title",
        "startAt": "2026-02-04T19:30:00.000Z",
        "endAt": null,
        "locationName": null,
        "locationAddress": null,
        "sourceUrl": "https://...",
        "description": "Event description text..."
      },
      "normalized": {
        "id": "funcheap_abc123",
        "title": "Event Title",
        "startAt": "2026-02-04T19:30:00.000Z",
        "endAt": null,
        "locationName": null,
        "locationAddress": null,
        "sourceUrl": "https://...",
        "description": "Event description text..."
      }
    }
  ]
}
```

## What to Check

When testing a new scraper, verify:

1. **Title**: Extracted correctly, not generic text like "Buy Tickets"
2. **Time**: Correct date and time parsing
3. **Location**: Venue name and address (if available)
4. **Description**: Brief description extracted from the page
5. **Source URL**: Valid link to the event page
6. **No duplicates**: Same event doesn't appear multiple times

## Scrape window (months ahead)

The `/api/scrape/run` pipeline only upserts events that start within a configurable window (default **90 days**).

- **Env**: `SCRAPE_WINDOW_DAYS=90`
- **Notes**: Some sources (notably Live Nation venues like `cobbs` and `punchline`) load more events via API pagination; those scrapers are implemented to fetch **at least** this window so we don’t miss “later” shows.

## Available Scrapers

- `funcheap` - Funcheap SF
- `bottomofthehill` - Bottom of the Hill
- `independent` - The Independent
- `greenapple` - Green Apple Books
- `booksmith` - The Booksmith
- `mannys` - Manny's
- `grayarea` - Gray Area
- `rickshaw` - Rickshaw Stop
- `cafedunord` - Cafe du Nord
- `envelop` - Envelope
- `brickandmortar` - Brick & Mortar
- `makeoutroom` - Make Out Room
- `cobbs` - Cobb's Comedy Club
- `punchline` - Punch Line Comedy Club
