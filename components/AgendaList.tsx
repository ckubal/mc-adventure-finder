"use client";

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useUser } from "@/lib/user-context";
import { getAuthToken } from "@/lib/api/getAuthToken";
import { basePath } from "@/lib/base-path";
import type { ApiEvent } from "@/app/api/events/route";
import type { EventStatus } from "@/types";
import {
  groupEventsByAgenda,
  getGroupLabel,
  startOfTodayLA,
  type AgendaGroupKey,
} from "@/lib/agenda/groupEvents";
import { VENUE_CATEGORIES } from "@/lib/venue-categories";
import { EventCard } from "./EventCard";

const ORDER: AgendaGroupKey[] = ["today", "this_week", "later"];

/** Unique sources from events: { sourceId, sourceName } */
function getSourcesFromEvents(events: ApiEvent[]): { sourceId: string; sourceName: string }[] {
  const byId = new Map<string, string>();
  for (const e of events) {
    if (e.sourceId && !byId.has(e.sourceId)) byId.set(e.sourceId, e.sourceName ?? e.sourceId);
  }
  return Array.from(byId.entries(), ([sourceId, sourceName]) => ({ sourceId, sourceName })).sort(
    (a, b) => a.sourceName.localeCompare(b.sourceName)
  );
}

/** All registered scrapers: { sourceId, sourceName } */
async function getAllRegisteredScrapers(): Promise<{ sourceId: string; sourceName: string }[]> {
  try {
    const res = await fetch(`${basePath}/api/scrapers`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.scrapers ?? []).map((s: { id: string; name: string }) => ({
      sourceId: s.id,
      sourceName: s.name,
    })).sort((a: { sourceName: string }, b: { sourceName: string }) => 
      a.sourceName.localeCompare(b.sourceName)
    );
  } catch {
    return [];
  }
}

export function AgendaList() {
  const { user } = useUser();
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, EventStatus>>({});
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  // Date filter: draft values in inputs, applied values for filtering (via Go button)
  const [dateRangeStart, setDateRangeStart] = useState<string>("");
  const [dateRangeEnd, setDateRangeEnd] = useState<string>("");
  const [draftDateRangeStart, setDraftDateRangeStart] = useState<string>("");
  const [draftDateRangeEnd, setDraftDateRangeEnd] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingEventId, setUpdatingEventId] = useState<string | null>(null);
  const [scrapeMessage, setScrapeMessage] = useState<string | null>(null);
  const [scrapeElapsed, setScrapeElapsed] = useState(0);
  const scrapeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [allSources, setAllSources] = useState<{ sourceId: string; sourceName: string }[]>([]);

  const filtersInitialized = useRef(false);
  useEffect(() => {
    getAllRegisteredScrapers().then((scrapers) => {
      setAllSources(scrapers);
      if (scrapers.length > 0 && !filtersInitialized.current) {
        setSelectedSourceIds(new Set(scrapers.map((s) => s.sourceId)));
        filtersInitialized.current = true;
      }
    });
  }, []);

  const sources = allSources.length > 0 ? allSources : getSourcesFromEvents(events);

  // Filter by source and date - memoized to ensure correct recomputation
  const filteredEvents = useMemo(() => {
    const todayStart = startOfTodayLA();
    // Exclude past events (API should already filter; this is a safety net)
    let filtered = events.filter((e) => new Date(e.startAt) >= todayStart);
    // Filter by source when sources are selected
    if (selectedSourceIds.size > 0) {
      filtered = filtered.filter((e) => selectedSourceIds.has(e.sourceId));
    }

    // Then filter by date range if set
    // - If only start date: show events from that date forward (no end limit)
    // - If only end date: show events up to that end date (still from today forward per API)
    // - If both: show events between start and end dates
    if (dateRangeStart || dateRangeEnd) {
      filtered = filtered.filter((e) => {
        const eventDate = new Date(e.startAt);
        
        // Filter out events before start date (if start date is set)
        // Compare date parts only (ignore time) to avoid timezone issues
        if (dateRangeStart) {
          const start = new Date(dateRangeStart + "T00:00:00");
          const eventDateOnly = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
          const startDateOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
          if (eventDateOnly < startDateOnly) return false;
        }
        
        // Filter out events after end date (if end date is set)
        // Compare date parts only (ignore time) to avoid timezone issues
        if (dateRangeEnd) {
          const end = new Date(dateRangeEnd + "T23:59:59");
          const eventDateOnly = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
          const endDateOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
          if (eventDateOnly > endDateOnly) return false;
        }
        
        return true;
      });
    }

    return filtered;
  }, [events, selectedSourceIds, dateRangeStart, dateRangeEnd]);

  const toggleSource = useCallback((sourceId: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }, []);

  const applyCategory = useCallback((sourceIds: string[] | null) => {
    if (sourceIds === null) {
      setSelectedSourceIds(new Set(sources.map((s) => s.sourceId)));
      return;
    }
    const available = new Set(sources.map((s) => s.sourceId));
    setSelectedSourceIds(new Set(sourceIds.filter((id) => available.has(id))));
  }, [sources]);

  const isAllSelected = sources.length > 0 && selectedSourceIds.size === sources.length;
  const activeCategoryId = useMemo(() => {
    if (isAllSelected) return "all";
    const sourceIdSet = new Set(sources.map((s) => s.sourceId));
    for (const cat of VENUE_CATEGORIES) {
      const catIdsInSources = cat.sourceIds.filter((id) => sourceIdSet.has(id));
      if (
        catIdsInSources.length > 0 &&
        selectedSourceIds.size === catIdsInSources.length &&
        catIdsInSources.every((id) => selectedSourceIds.has(id))
      ) {
        return cat.id;
      }
    }
    return null;
  }, [selectedSourceIds, sources]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`${basePath}/api/events`);
      if (!res.ok) throw new Error("Failed to fetch events");
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (e) {
      console.error(e);
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchUserStatus = useCallback(async () => {
    if (!user) {
      setStatusMap({});
      return;
    }
    const token = await getAuthToken();
    if (!token) {
      setStatusMap({});
      return;
    }
    try {
      const res = await fetch(`${basePath}/api/user-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, EventStatus> = {};
      for (const s of data.statuses ?? []) {
        map[s.eventId] = s.status;
      }
      setStatusMap(map);
    } catch {
      setStatusMap({});
    }
  }, [user]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    fetchUserStatus();
  }, [fetchUserStatus]);

  const handleRefresh = useCallback(async (dryRun = false) => {
    setRefreshing(true);
    setScrapeMessage(null);
    setScrapeElapsed(0);
    scrapeIntervalRef.current = setInterval(() => {
      setScrapeElapsed((n) => n + 1);
    }, 1000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000); // 90s max
    const url = dryRun ? `${basePath}/api/scrape/run?dryRun=true` : `${basePath}/api/scrape/run`;
    try {
      const scrapeRes = await fetch(url, {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (scrapeIntervalRef.current) {
        clearInterval(scrapeIntervalRef.current);
        scrapeIntervalRef.current = null;
      }
      const scrapeData = await scrapeRes.json().catch(() => ({}));
      if (!scrapeRes.ok) {
        const err =
          scrapeData?.error ?? `HTTP ${scrapeRes.status}`;
        setScrapeMessage(`Scrape failed: ${err}`);
        await fetchEvents();
        return;
      }
      const total = scrapeData?.totalUpserted ?? 0;
      const results = scrapeData?.results ?? [];
      const errors = results.flatMap((r: { sourceId: string; errors: string[] }) =>
        (r.errors ?? []).map((e: string) => `${r.sourceId}: ${e}`)
      );
      if (dryRun) {
        setScrapeMessage(
          total > 0
            ? `Test run: would save ${total} events (nothing written to Firebase).`
            : errors.length > 0
              ? `Test run: 0 events. First error: ${errors[0].slice(0, 60)}…`
              : "Test run: 0 events. Check server logs for details."
        );
      } else if (total > 0) {
        setScrapeMessage(`Scraped ${total} events.`);
      } else if (errors.length > 0) {
        setScrapeMessage(
          `Scraped 0 events. First error: ${errors[0].slice(0, 80)}…`
        );
      } else {
        setScrapeMessage(
          "Scrape finished with 0 events. Check server logs (terminal) for details."
        );
      }
      if (!dryRun) await fetchEvents();
    } catch (e) {
      clearTimeout(timeoutId);
      if (scrapeIntervalRef.current) {
        clearInterval(scrapeIntervalRef.current);
        scrapeIntervalRef.current = null;
      }
      const isTimeout = e instanceof Error && e.name === "AbortError";
      const msg = isTimeout
        ? "Scrape timed out after 90 seconds. Some sources may still have run—check the list."
        : e instanceof Error ? e.message : String(e);
      setScrapeMessage(`Scrape failed: ${msg}`);
      if (!isTimeout) console.error(e);
      await fetchEvents();
    } finally {
      setRefreshing(false);
      setScrapeElapsed(0);
      if (scrapeIntervalRef.current) {
        clearInterval(scrapeIntervalRef.current);
        scrapeIntervalRef.current = null;
      }
    }
  }, [fetchEvents]);

  const handleStatusChange = useCallback(
    async (eventId: string, status: EventStatus) => {
      const token = await getAuthToken();
      if (!token) return;
      setUpdatingEventId(eventId);
      try {
        const res = await fetch(`${basePath}/api/user-status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ eventId, status }),
        });
        if (!res.ok) throw new Error("Failed to set status");
        setStatusMap((prev) => ({ ...prev, [eventId]: status }));
      } catch (e) {
        console.error(e);
      } finally {
        setUpdatingEventId(null);
      }
    },
    []
  );

  if (loading) {
    return (
      <div className="py-8 text-center font-bold text-2xl" style={{ 
        color: "#000", 
        textShadow: "2px 2px 0px #fff, 4px 4px 0px #ff00ff",
        animation: "blink 1s infinite"
      }}>
        Loading events… ⏳
      </div>
    );
  }

  const grouped = groupEventsByAgenda(filteredEvents);

  // Format date for input (YYYY-MM-DD)
  const formatDateForInput = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Date inputs are "YYYY-MM-DD". Parsing `new Date("YYYY-MM-DD")` is UTC and can show
  // the prior day in Pacific time. Treat picked dates as local midnight for display.
  const formatPickedDateLabel = (ymd: string): string => {
    const d = new Date(`${ymd}T00:00:00`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const clearDateRange = () => {
    setDateRangeStart("");
    setDateRangeEnd("");
    setDraftDateRangeStart("");
    setDraftDateRangeEnd("");
  };

  const applyDateRange = () => {
    setDateRangeStart(draftDateRangeStart);
    setDateRangeEnd(draftDateRangeEnd);
  };

  const hasDraftChanges =
    draftDateRangeStart !== dateRangeStart || draftDateRangeEnd !== dateRangeEnd;
  const hasAnyDateSelected =
    !!dateRangeStart || !!dateRangeEnd || !!draftDateRangeStart || !!draftDateRangeEnd;

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <div className="flex flex-wrap items-center gap-3 p-3 border-4 border-black" style={{
        background: "linear-gradient(135deg, #ffff00, #ff00ff)",
        boxShadow: "5px 5px 0px #000"
      }}>
        <span className="text-sm font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>📅 Date Range:</span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={draftDateRangeStart}
            onChange={(e) => setDraftDateRangeStart(e.target.value)}
            className="px-2 py-1 text-sm font-bold border-2 border-black"
            style={{
              background: "#fff",
              color: "#000",
              boxShadow: "2px 2px 0px #000"
            }}
            placeholder="Start date"
          />
          <span className="text-sm font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>to</span>
          <input
            type="date"
            value={draftDateRangeEnd}
            onChange={(e) => setDraftDateRangeEnd(e.target.value)}
            className="px-2 py-1 text-sm font-bold border-2 border-black"
            style={{
              background: "#fff",
              color: "#000",
              boxShadow: "2px 2px 0px #000"
            }}
            placeholder="End date"
          />
          {hasDraftChanges && (
            <button
              type="button"
              onClick={applyDateRange}
              className="px-2 py-1 text-xs font-bold border-2 border-black"
              style={{
                background: "linear-gradient(135deg, #00ff00, #00ffff)",
                color: "#000",
                textShadow: "1px 1px 0px #fff",
                boxShadow: "2px 2px 0px #000",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translate(1px, 1px)";
                e.currentTarget.style.boxShadow = "1px 1px 0px #000";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translate(0, 0)";
                e.currentTarget.style.boxShadow = "2px 2px 0px #000";
              }}
            >
              Go
            </button>
          )}

          {hasAnyDateSelected && (
            <button
              type="button"
              onClick={clearDateRange}
              className="px-2 py-1 text-xs font-bold border-2 border-black"
              style={{
                background: "linear-gradient(135deg, #00ffff, #ff00ff)",
                color: "#000",
                textShadow: "1px 1px 0px #fff",
                boxShadow: "2px 2px 0px #000"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translate(1px, 1px)";
                e.currentTarget.style.boxShadow = "1px 1px 0px #000";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translate(0, 0)";
                e.currentTarget.style.boxShadow = "2px 2px 0px #000";
              }}
            >
              Clear
            </button>
          )}
        </div>
        {(dateRangeStart || dateRangeEnd) && (
          <span className="text-xs font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>
            {dateRangeStart && dateRangeEnd
              ? `${formatPickedDateLabel(dateRangeStart)} - ${formatPickedDateLabel(dateRangeEnd)}`
              : dateRangeStart
                ? `From ${formatPickedDateLabel(dateRangeStart)}`
                : `Until ${formatPickedDateLabel(dateRangeEnd)}`}
          </span>
        )}
      </div>

      {/* Category quick-filters (select just those venues) */}
      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 border-4 border-black" style={{
          background: "linear-gradient(135deg, #ff00ff, #ffff00)",
          boxShadow: "5px 5px 0px #000"
        }}>
          <span className="text-xs font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>📂 Categories:</span>
          <button
            type="button"
            onClick={() => applyCategory(null)}
            className="px-3 py-1.5 text-sm font-bold border-2 border-black transition"
            style={{
              background: activeCategoryId === "all" ? "linear-gradient(135deg, #ff00ff, #00ffff)" : "linear-gradient(135deg, #ccc, #999)",
              color: "#000",
              textShadow: "1px 1px 0px #fff",
              boxShadow: activeCategoryId === "all" ? "3px 3px 0px #000" : "2px 2px 0px #000",
            }}
            onMouseEnter={(e) => {
              if (activeCategoryId !== "all") {
                e.currentTarget.style.transform = "translate(2px, 2px)";
                e.currentTarget.style.boxShadow = "1px 1px 0px #000";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translate(0, 0)";
              e.currentTarget.style.boxShadow = activeCategoryId === "all" ? "3px 3px 0px #000" : "2px 2px 0px #000";
            }}
          >
            All
          </button>
          {VENUE_CATEGORIES.map((cat) => {
            const isActive = activeCategoryId === cat.id;
            const countInSources = cat.sourceIds.filter((id) => sources.some((s) => s.sourceId === id)).length;
            if (countInSources === 0) return null;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => applyCategory(cat.sourceIds)}
                className="px-3 py-1.5 text-sm font-bold border-2 border-black transition"
                style={{
                  background: isActive ? "linear-gradient(135deg, #ff00ff, #00ffff)" : "linear-gradient(135deg, #ccc, #999)",
                  color: "#000",
                  textShadow: "1px 1px 0px #fff",
                  boxShadow: isActive ? "3px 3px 0px #000" : "2px 2px 0px #000",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.transform = "translate(2px, 2px)";
                    e.currentTarget.style.boxShadow = "1px 1px 0px #000";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translate(0, 0)";
                  e.currentTarget.style.boxShadow = isActive ? "3px 3px 0px #000" : "2px 2px 0px #000";
                }}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Source Filters */}
      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 border-4 border-black" style={{
          background: "linear-gradient(135deg, #00ffff, #ffff00)",
          boxShadow: "5px 5px 0px #000"
        }}>
          <span className="text-xs font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>🎯 Sources:</span>
          {sources.map(({ sourceId, sourceName }) => {
            const selected = selectedSourceIds.has(sourceId);
            return (
              <button
                key={sourceId}
                type="button"
                onClick={() => toggleSource(sourceId)}
                className="px-3 py-1 text-sm font-bold border-2 border-black transition"
                style={{
                  background: selected 
                    ? "linear-gradient(135deg, #ff00ff, #00ffff)"
                    : "linear-gradient(135deg, #ccc, #999)",
                  color: "#000",
                  textShadow: "1px 1px 0px #fff",
                  boxShadow: selected ? "3px 3px 0px #000" : "2px 2px 0px #000",
                  textDecoration: selected ? "none" : "line-through",
                  opacity: selected ? 1 : 0.6
                }}
                onMouseEnter={(e) => {
                  if (selected) {
                    e.currentTarget.style.transform = "translate(2px, 2px)";
                    e.currentTarget.style.boxShadow = "1px 1px 0px #000";
                  }
                }}
                onMouseLeave={(e) => {
                  if (selected) {
                    e.currentTarget.style.transform = "translate(0, 0)";
                    e.currentTarget.style.boxShadow = "3px 3px 0px #000";
                  }
                }}
              >
                {sourceName}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold" style={{ color: "#000", textShadow: "2px 2px 0px #fff" }}>
            🎉 {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
            {dateRangeStart && dateRangeEnd
              ? ` from ${formatPickedDateLabel(dateRangeStart)} to ${formatPickedDateLabel(dateRangeEnd)}`
              : dateRangeStart
                ? ` from ${formatPickedDateLabel(dateRangeStart)} forward`
                : dateRangeEnd
                  ? ` up to ${formatPickedDateLabel(dateRangeEnd)}`
                  : " from today forward"} 🎉
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleRefresh(true)}
              disabled={refreshing}
              className="px-3 py-1.5 text-sm font-bold border-2 border-black"
              style={{
                background: "linear-gradient(135deg, #ffff00, #ff00ff)",
                color: "#000",
                textShadow: "1px 1px 0px #fff",
                boxShadow: "3px 3px 0px #000",
                opacity: refreshing ? 0.6 : 1,
                cursor: refreshing ? "not-allowed" : "pointer"
              }}
              onMouseEnter={(e) => {
                if (!refreshing) {
                  e.currentTarget.style.transform = "translate(2px, 2px)";
                  e.currentTarget.style.boxShadow = "1px 1px 0px #000";
                }
              }}
              onMouseLeave={(e) => {
                if (!refreshing) {
                  e.currentTarget.style.transform = "translate(0, 0)";
                  e.currentTarget.style.boxShadow = "3px 3px 0px #000";
                }
              }}
            >
              {refreshing ? `Scraping… ${scrapeElapsed}s` : "🧪 Test run (no save)"}
            </button>
            <button
              type="button"
              onClick={() => handleRefresh(false)}
              disabled={refreshing}
              className="px-3 py-1.5 text-sm font-bold border-2 border-black"
              style={{
                background: "linear-gradient(135deg, #ff00ff, #00ffff)",
                color: "#000",
                textShadow: "1px 1px 0px #fff",
                boxShadow: "3px 3px 0px #000",
                opacity: refreshing ? 0.6 : 1,
                cursor: refreshing ? "not-allowed" : "pointer"
              }}
              onMouseEnter={(e) => {
                if (!refreshing) {
                  e.currentTarget.style.transform = "translate(2px, 2px)";
                  e.currentTarget.style.boxShadow = "1px 1px 0px #000";
                }
              }}
              onMouseLeave={(e) => {
                if (!refreshing) {
                  e.currentTarget.style.transform = "translate(0, 0)";
                  e.currentTarget.style.boxShadow = "3px 3px 0px #000";
                }
              }}
            >
              {refreshing ? `Scraping sources… ${scrapeElapsed}s` : "🔄 Refresh"}
            </button>
          </div>
        </div>
        {refreshing && (
          <p className="text-sm font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }} role="status">
            Can take 20–60s. Don’t navigate away.
          </p>
        )}
        {scrapeMessage && !refreshing && (
          <p
            className="text-sm font-bold"
            style={{ color: "#000", textShadow: "2px 2px 0px #ffff00" }}
            role="status"
          >
            {scrapeMessage}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-8">
        {ORDER.map((key) => {
          const list = grouped.get(key) ?? [];
          if (list.length === 0) return null;
          const label = getGroupLabel(key);
          return (
            <section key={key}>
              <h2 className="mb-3 text-lg font-bold uppercase tracking-wide" style={{
                color: "#000",
                textShadow: "3px 3px 0px #fff, -1px -1px 0px #ff00ff",
                background: "linear-gradient(45deg, #ff00ff, #00ffff, #ffff00)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text"
              }}>
                {label}
              </h2>
              <ul className="flex flex-col gap-3">
                {list.map((event) => (
                  <li key={event.id}>
                    <EventCard
                      event={event}
                      status={user ? statusMap[event.id] ?? null : null}
                      onStatusChange={handleStatusChange}
                      isUpdating={updatingEventId === event.id}
                      firebaseUid={user?.uid ?? null}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {filteredEvents.length === 0 && (
        <p className="py-8 text-center text-xl font-bold" style={{
          color: "#000",
          textShadow: "2px 2px 0px #fff, 4px 4px 0px #ff00ff"
        }}>
          {events.length === 0
            ? "😢 No upcoming events. Click Refresh to scrape sources. 😢"
            : "🤷 No events for selected sources. Tap a source above to include it. 🤷"}
        </p>
      )}
    </div>
  );
}
