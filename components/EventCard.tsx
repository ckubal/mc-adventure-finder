"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import type { EventStatus } from "@/types";
import type { ApiEvent } from "@/app/api/events/route";
import { basePath } from "@/lib/base-path";

const STATUS_OPTIONS: { value: EventStatus; label: string }[] = [
  { value: "interested", label: "Interested" },
  { value: "not_interested", label: "Not" },
  { value: "going", label: "Going" },
];

const TIMEZONE = "America/Los_Angeles";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

interface EventCardProps {
  event: ApiEvent;
  status: EventStatus | null;
  onStatusChange: (eventId: string, status: EventStatus) => void;
  isUpdating?: boolean;
  firebaseUid?: string | null;
}

export function EventCard({
  event,
  status,
  onStatusChange,
  isUpdating = false,
  firebaseUid = null,
}: EventCardProps) {
  const { data: session, status: sessionStatus } = useSession();
  const [syncing, setSyncing] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const location = event.locationName ?? event.sourceName;
  const canSync = status === "interested" || status === "going";
  const hasCalendarSession = sessionStatus === "authenticated" && !!session?.user?.email;
  const hasDescription = !!event.description && event.description.trim().length > 0;

  const handleSyncToCalendar = async () => {
    if (!canSync || !status) return;
    if (!hasCalendarSession) {
      await signIn("google", { callbackUrl: window.location.href });
      return;
    }
    if (!firebaseUid) return;
    setSyncing(true);
    try {
      const res = await fetch(`${basePath}/api/calendar/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          status,
          firebaseUid,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to sync to Google Calendar");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to sync to Google Calendar");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <article className="p-4 border-4 border-black" style={{
      background: "linear-gradient(135deg, #fff, #ffff00)",
      boxShadow: "5px 5px 0px #000"
    }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-lg hover:underline"
            style={{
              color: "#000",
              textShadow: "3px 3px 0px #fff, 2px 2px 0px #fff, 1px 1px 0px #fff, -1px -1px 0px #fff, -1px 1px 0px #fff, 1px -1px 0px #fff"
            }}
          >
            {event.title}
          </a>
          <p className="mt-1 text-sm font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>
            📅 {formatDate(event.startAt)} · ⏰ {formatTime(event.startAt)}
            {event.endAt && (
              <span> – {formatTime(event.endAt)}</span>
            )}
          </p>
          {location && (
            <p className="mt-0.5 text-sm font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>
              📍 {location}
            </p>
          )}
          {hasDescription && (
            <button
              type="button"
              onClick={() => setShowDescription(!showDescription)}
              className="mt-2 flex items-center gap-1 text-xs font-bold border-2 border-black px-2 py-1"
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
              <span>{showDescription ? "▼" : "▶"}</span>
              <span>Description</span>
            </button>
          )}
          {hasDescription && showDescription && (
            <div className="mt-2 p-2 text-sm font-bold border-2 border-black" style={{
              background: "#fff",
              color: "#000",
              boxShadow: "2px 2px 0px #000"
            }}>
              {event.description}
            </div>
          )}
          <span className="mt-2 inline-block px-2 py-0.5 text-xs font-bold border-2 border-black" style={{
            background: "linear-gradient(135deg, #ffff00, #ff00ff)",
            color: "#000",
            textShadow: "2px 2px 0px #fff, -1px -1px 0px #fff, 1px -1px 0px #fff, -1px 1px 0px #fff",
            boxShadow: "2px 2px 0px #000"
          }}>
            {event.sourceName}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {firebaseUid != null && (
          <>
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={isUpdating}
                onClick={() => onStatusChange(event.id, opt.value)}
                className="px-2.5 py-1 text-sm font-bold border-2 border-black transition"
                style={{
                  background: status === opt.value
                    ? "linear-gradient(135deg, #ff00ff, #00ffff)"
                    : "linear-gradient(135deg, #ffff00, #ff00ff)",
                  color: "#000",
                  textShadow: "1px 1px 0px #fff",
                  boxShadow: status === opt.value ? "3px 3px 0px #000" : "2px 2px 0px #000",
                  opacity: isUpdating ? 0.6 : 1,
                  cursor: isUpdating ? "not-allowed" : "pointer"
                }}
                onMouseEnter={(e) => {
                  if (!isUpdating && status === opt.value) {
                    e.currentTarget.style.transform = "translate(2px, 2px)";
                    e.currentTarget.style.boxShadow = "1px 1px 0px #000";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isUpdating && status === opt.value) {
                    e.currentTarget.style.transform = "translate(0, 0)";
                    e.currentTarget.style.boxShadow = "3px 3px 0px #000";
                  }
                }}
              >
                {opt.label}
              </button>
            ))}
          </>
        )}
        <a
          href={`${basePath}/api/calendar/ics?eventId=${encodeURIComponent(event.id)}&status=${encodeURIComponent(status ?? "interested")}`}
          download={`${event.id}.ics`}
          className="px-2.5 py-1 text-sm font-bold border-2 border-black"
          style={{
            background: "linear-gradient(135deg, #00ffff, #ffff00)",
            color: "#000",
            textShadow: "1px 1px 0px #fff",
            boxShadow: "2px 2px 0px #000",
            textDecoration: "none",
            display: "inline-block"
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
          📥 Download .ics
        </a>
        {canSync && (
          <button
            type="button"
            onClick={handleSyncToCalendar}
            disabled={syncing || isUpdating}
            className="px-2.5 py-1 text-sm font-bold border-2 border-black"
            style={{
              background: "linear-gradient(135deg, #ff00ff, #ffff00)",
              color: "#000",
              textShadow: "1px 1px 0px #fff",
              boxShadow: "2px 2px 0px #000",
              opacity: (syncing || isUpdating) ? 0.6 : 1,
              cursor: (syncing || isUpdating) ? "not-allowed" : "pointer"
            }}
            onMouseEnter={(e) => {
              if (!syncing && !isUpdating) {
                e.currentTarget.style.transform = "translate(1px, 1px)";
                e.currentTarget.style.boxShadow = "1px 1px 0px #000";
              }
            }}
            onMouseLeave={(e) => {
              if (!syncing && !isUpdating) {
                e.currentTarget.style.transform = "translate(0, 0)";
                e.currentTarget.style.boxShadow = "2px 2px 0px #000";
              }
            }}
          >
            {syncing ? "Syncing…" : hasCalendarSession ? "📅 Sync to Google Calendar" : "🔗 Connect Google Calendar"}
          </button>
        )}
        {firebaseUid == null && (
          <span className="text-xs font-bold" style={{ color: "#000", textShadow: "1px 1px 0px #fff" }}>
            🔐 Sign in to save Interested / Going
          </span>
        )}
      </div>
    </article>
  );
}
