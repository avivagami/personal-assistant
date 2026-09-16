import { google, type calendar_v3 } from "googleapis";
import { requireGoogle } from "./auth.js";
import { config } from "../config.js";

export interface EventSummary {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
  description: string;
  attendees: string[];
  htmlLink: string;
}

async function cal(): Promise<calendar_v3.Calendar> {
  return google.calendar({ version: "v3", auth: await requireGoogle() });
}

function summarise(e: calendar_v3.Schema$Event): EventSummary {
  return {
    id: e.id ?? "",
    title: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location ?? "",
    description: (e.description ?? "").slice(0, 1000),
    attendees: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    htmlLink: e.htmlLink ?? "",
  };
}

export async function listEvents(fromIso: string, toIso: string, max = 30): Promise<EventSummary[]> {
  const c = await cal();
  const res = await c.events.list({
    calendarId: "primary",
    timeMin: fromIso,
    timeMax: toIso,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: max,
  });
  return (res.data.items ?? []).map(summarise);
}

export async function searchEvents(query: string, max = 20): Promise<EventSummary[]> {
  const c = await cal();
  const res = await c.events.list({
    calendarId: "primary",
    q: query,
    singleEvents: true,
    orderBy: "startTime",
    timeMin: new Date(Date.now() - 30 * 86400_000).toISOString(),
    maxResults: max,
  });
  return (res.data.items ?? []).map(summarise);
}

export interface NewEvent {
  title: string;
  startIso: string;
  endIso: string;
  location?: string;
  description?: string;
  attendees?: string[];
}

/** Writes. Only ever called by the approval gate. */
export async function createEvent(ev: NewEvent): Promise<EventSummary> {
  const c = await cal();
  const tz = config().TIMEZONE;
  const res = await c.events.insert({
    calendarId: "primary",
    sendUpdates: ev.attendees?.length ? "all" : "none",
    requestBody: {
      summary: ev.title,
      location: ev.location,
      description: ev.description,
      start: { dateTime: ev.startIso, timeZone: tz },
      end: { dateTime: ev.endIso, timeZone: tz },
      attendees: ev.attendees?.map((email) => ({ email })),
    },
  });
  return summarise(res.data);
}

export async function deleteEvent(eventId: string): Promise<void> {
  const c = await cal();
  await c.events.delete({ calendarId: "primary", eventId, sendUpdates: "all" });
}
