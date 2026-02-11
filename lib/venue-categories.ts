/**
 * Venue categories for quick-filtering above the source list.
 * Each category maps to source IDs (must match scraper ids in lib/scrapers/sources).
 * Covers all registered sources: Music, Books, Comedy, Culture.
 */
export const VENUE_CATEGORIES: { id: string; label: string; sourceIds: string[] }[] = [
  {
    id: "music",
    label: "Music",
    sourceIds: [
      "rickshaw",
      "independent",
      "bottomofthehill",
      "cafedunord",
      "sfjazz",
      "makeoutroom",
      "brickandmortar",
      "1015folsom",
    ],
  },
  {
    id: "sports",
    label: "Sports",
    sourceIds: ["warriors", "giants"],
  },
  {
    id: "books",
    label: "Books",
    sourceIds: ["greenapple", "booksmith"],
  },
  {
    id: "comedy",
    label: "Comedy",
    sourceIds: ["cobbs", "punchline"],
  },
  {
    id: "culture",
    label: "Culture",
    sourceIds: ["funcheap", "envelop", "grayarea", "mannys"],
  },
];
