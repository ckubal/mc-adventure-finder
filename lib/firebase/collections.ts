export const COLLECTIONS = {
  EVENTS: "events",
  USER_EVENT_STATUS: "userEventStatus",
} as const;

export function userEventStatusId(uid: string, eventId: string): string {
  return `${uid}_${eventId}`;
}
