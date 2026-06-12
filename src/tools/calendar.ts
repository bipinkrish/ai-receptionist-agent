/**
 * All class times use STUDIO_TIMEZONE from .env (see studio-time.ts).
 *
 * Capacity convention (stored in event description):
 *   "Capacity: 6/8"  → 6 spots taken, 8 max
 *   Attendees listed as lines: "Attendee: Jane Doe (555-1234)"
 */

import { calendar, CALENDAR_ID } from "../google-auth.js";
import {
  STUDIO_TIMEZONE,
  addDaysToDateTime,
  nextDateForDay,
  parseTimeToHourMinute,
} from "../studio-time.js";

const CAPACITY_REGEX = /Capacity:\s*(\d+)\/(\d+)/i;
const ATTENDEE_REGEX = /^Attendee:\s*(.+?)\s*\(([^)]+)\)/im;

export interface AvailabilityResult {
  found: boolean;
  className: string;
  dateTime: string;
  isFull: boolean;
  spotsRemaining: number;
  maxCapacity: number;
  alternatives: Array<{ className: string; dateTime: string; spotsRemaining: number }>;
}

function parseCapacity(description: string): { booked: number; max: number } {
  const match = description.match(CAPACITY_REGEX);
  if (!match) return { booked: 0, max: 8 };
  return { booked: parseInt(match[1], 10), max: parseInt(match[2], 10) };
}

function updateCapacityLine(description: string, booked: number, max: number): string {
  const line = `Capacity: ${booked}/${max}`;
  if (CAPACITY_REGEX.test(description)) {
    return description.replace(CAPACITY_REGEX, line);
  }
  return description.trim() ? `${description.trim()}\n${line}` : line;
}

function findAttendeeLines(description: string): string[] {
  return description.split("\n").filter((l) => l.startsWith("Attendee:"));
}

function formatAttendeeLine(name: string, phone: string): string {
  return `Attendee: ${name} (${phone})`;
}

function matchesAttendee(description: string, nameOrPhone: string): boolean {
  const needle = nameOrPhone.toLowerCase();
  return findAttendeeLines(description).some((line) => {
    const match = line.match(ATTENDEE_REGEX);
    if (!match) return line.toLowerCase().includes(needle);
    const [, name, phone] = match;
    return name.toLowerCase().includes(needle) || phone.replace(/\D/g, "").includes(needle.replace(/\D/g, ""));
  });
}

function removeAttendee(description: string, nameOrPhone: string): string {
  const needle = nameOrPhone.toLowerCase();
  return description
    .split("\n")
    .filter((line) => {
      if (!line.startsWith("Attendee:")) return true;
      const match = line.match(ATTENDEE_REGEX);
      if (!match) return !line.toLowerCase().includes(needle);
      const [, name, phone] = match;
      const hit =
        name.toLowerCase().includes(needle) ||
        phone.replace(/\D/g, "").includes(needle.replace(/\D/g, ""));
      return !hit;
    })
    .join("\n");
}

function listRangeAround(studioLocal: string, daysBefore: number, daysAfter: number) {
  const start = addDaysToDateTime(studioLocal, -daysBefore).slice(0, 10);
  const end = addDaysToDateTime(studioLocal, daysAfter).slice(0, 10);
  return {
    timeMin: `${start}T00:00:00Z`,
    timeMax: `${end}T23:59:59Z`,
  };
}

async function listEventsInRange(timeMin: string, timeMax: string) {
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    timeZone: STUDIO_TIMEZONE,
  });
  return res.data.items ?? [];
}

function eventStudioHour(dateTime: string): number {
  const d = new Date(dateTime);
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).format(d);
  return parseInt(hour, 10);
}

function eventMatchesClass(
  event: { summary?: string | null; start?: { dateTime?: string | null } },
  className: string,
  targetDateTime?: string,
): boolean {
  const summary = (event.summary ?? "").toLowerCase();
  if (className && !summary.includes(className.toLowerCase())) return false;
  if (!targetDateTime || !event.start?.dateTime) return true;

  const eventDate = event.start.dateTime.slice(0, 10);
  const targetDate = targetDateTime.slice(0, 10);
  if (eventDate !== targetDate) return false;

  const targetHour = parseInt(targetDateTime.slice(11, 13), 10);
  return eventStudioHour(event.start.dateTime) === targetHour;
}

export async function checkAvailability(
  className: string,
  dayOfWeek: string,
  time: string,
): Promise<AvailabilityResult> {
  const { hour, minute } = parseTimeToHourMinute(time);
  const targetDateTime = nextDateForDay(dayOfWeek, hour, minute);
  const { timeMin, timeMax } = listRangeAround(targetDateTime, 1, 14);

  const events = await listEventsInRange(timeMin, timeMax);
  const matching = events.filter((e) => eventMatchesClass(e, className, targetDateTime));

  const alternatives: AvailabilityResult["alternatives"] = [];
  for (const event of events) {
    if (!event.summary?.toLowerCase().includes(className.toLowerCase())) continue;
    const { booked, max } = parseCapacity(event.description ?? "");
    const remaining = max - booked;
    if (remaining > 0 && event.start?.dateTime) {
      alternatives.push({
        className: event.summary ?? className,
        dateTime: event.start.dateTime,
        spotsRemaining: remaining,
      });
    }
  }

  if (matching.length === 0) {
    return {
      found: false,
      className,
      dateTime: targetDateTime,
      isFull: false,
      spotsRemaining: 0,
      maxCapacity: 0,
      alternatives: alternatives.slice(0, 5),
    };
  }

  const event = matching[0];
  const { booked, max } = parseCapacity(event.description ?? "");
  const remaining = max - booked;

  return {
    found: true,
    className: event.summary ?? className,
    dateTime: event.start?.dateTime ?? targetDateTime,
    isFull: remaining <= 0,
    spotsRemaining: remaining,
    maxCapacity: max,
    alternatives: alternatives
      .filter((a) => a.dateTime !== event.start?.dateTime)
      .slice(0, 5),
  };
}

export async function bookClass(
  className: string,
  dateTime: string,
  callerName: string,
  callerPhone: string,
): Promise<{ success: boolean; message: string }> {
  const { timeMin, timeMax } = listRangeAround(dateTime, 0, 0);
  const events = await listEventsInRange(timeMin, timeMax);
  const event = events.find((e) => eventMatchesClass(e, className, dateTime));

  if (!event?.id) {
    return { success: false, message: `No ${className} class found at ${dateTime}.` };
  }

  const description = event.description ?? "";
  if (matchesAttendee(description, callerPhone) || matchesAttendee(description, callerName)) {
    return { success: true, message: `${callerName} is already booked for this class.` };
  }

  const { booked, max } = parseCapacity(description);
  if (booked >= max) {
    return { success: false, message: `This class is full (${booked}/${max}).` };
  }

  const newBooked = booked + 1;
  const newDescription = [
    updateCapacityLine(description, newBooked, max),
    formatAttendeeLine(callerName, callerPhone),
  ].join("\n");

  await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: event.id,
    requestBody: { description: newDescription },
  });

  return {
    success: true,
    message: `Booked ${callerName} for ${event.summary} on ${dateTime}. Spots remaining: ${max - newBooked}.`,
  };
}

export async function rescheduleClass(
  callerIdentifier: string,
  fromDateTime: string,
  toClassName: string,
  toDateTime: string,
): Promise<{ success: boolean; message: string }> {
  const { timeMin, timeMax } = listRangeAround(fromDateTime, 1, 1);
  const events = await listEventsInRange(timeMin, timeMax);
  const oldEvent =
    events.find(
      (e) =>
        eventMatchesClass(e, "", fromDateTime) &&
        matchesAttendee(e.description ?? "", callerIdentifier),
    ) ?? events.find((e) => matchesAttendee(e.description ?? "", callerIdentifier));

  if (!oldEvent?.id) {
    return { success: false, message: `No existing booking found for ${callerIdentifier}.` };
  }

  const oldDescription = oldEvent.description ?? "";
  const attendeeLine = findAttendeeLines(oldDescription).find((l) => {
    const match = l.match(ATTENDEE_REGEX);
    if (!match) return l.toLowerCase().includes(callerIdentifier.toLowerCase());
    const [, name, phone] = match;
    const needle = callerIdentifier.toLowerCase();
    return name.toLowerCase().includes(needle) || phone.includes(callerIdentifier);
  });

  if (!attendeeLine) {
    return { success: false, message: `Could not locate attendee record for ${callerIdentifier}.` };
  }

  const match = attendeeLine.match(ATTENDEE_REGEX);
  const callerName = match?.[1] ?? callerIdentifier;
  const callerPhone = match?.[2] ?? callerIdentifier;

  const { booked, max } = parseCapacity(oldDescription);
  const cleanedOld = removeAttendee(oldDescription, callerIdentifier);
  const newOldDescription = updateCapacityLine(cleanedOld, Math.max(0, booked - 1), max);

  await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: oldEvent.id,
    requestBody: { description: newOldDescription },
  });

  return bookClass(toClassName, toDateTime, callerName, callerPhone);
}
