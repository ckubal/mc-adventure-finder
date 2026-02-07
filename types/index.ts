import { Timestamp } from "firebase/firestore";

export type EventStatus = "interested" | "not_interested" | "going";

export interface Event {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  title: string;
  startAt: Timestamp | Date;
  endAt: Timestamp | Date | null;
  locationName: string | null;
  locationAddress: string | null;
  tags: string[];
  raw?: Record<string, unknown>;
}

export interface UserEventStatus {
  id: string;
  uid: string;
  eventId: string;
  status: EventStatus;
  updatedAt: Timestamp | Date;
  gcalEventId?: string;
}

export const CALENDAR_INVITE_EMAILS = [
  "ckubal@gmail.com",
  "mariesbrocca@gmail.com",
  "ckubal@roblox.com",
] as const;

export const DEFAULT_TIMEZONE = "America/Los_Angeles";
export const DEFAULT_EVENT_DURATION_HOURS = 2;
