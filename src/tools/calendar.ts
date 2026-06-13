/**
 * Bookings are 30-minute sessions within business hours (see business-hours.ts).
 * Each calendar event = one booked session. Overlapping events block that slot.
 */

import { calendar, CALENDAR_ID } from "../google-auth.js";
import {
  SLOT_MINUTES,
  formatHoursForDisplay,
  getBusinessHours,
  getDayHours,
  getDayIndex,
  isStudioHoliday,
  minutesToClock,
  normalizeLocalDateTime,
  parseClockToMinutes,
  parseTimeToMinutes,
  isSessionSlotInPast,
  isStudioDateFullyPast,
  validateSessionSlot,
  weekdayFromDate,
} from "../business-hours.js";
import {
  STUDIO_TIMEZONE,
  addDaysToDateTime,
  formatStudioDateTime,
  nextDateForDay,
  studioDateParts,
} from "../studio-time.js";
import { normalizeCallerNameKey, namesMatch } from "./caller-identity.js";

export interface SlotInfo {
  dateTime: string;
  displayTime: string;
  date: string;
}

export interface AvailabilityResult {
  available: boolean;
  dateTime: string;
  date: string;
  displayTime: string;
  reason?: string;
  nearbySlots: SlotInfo[];
}

function studioDateFromDateTime(dateTime: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(dateTime));
}

function studioMinutesFromDateTime(dateTime: string): number {
  const normalized = normalizeLocalDateTime(dateTime);
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(dateTime) || dateTime.endsWith("Z");
  if (!hasOffset) {
    const [, timePart] = normalized.split("T");
    const [h, m] = timePart.split(":").map(Number);
    return h * 60 + m;
  }
  const d = new Date(dateTime);
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_TIMEZONE, hour: "numeric", hour12: false }).format(d),
    10,
  );
  const minute = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: STUDIO_TIMEZONE, minute: "numeric" }).format(d),
    10,
  );
  return hour * 60 + minute;
}

function formatDisplayTime(dateTime: string): string {
  const normalized = normalizeLocalDateTime(dateTime);
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(dateTime) || dateTime.endsWith("Z");
  if (hasOffset) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: STUDIO_TIMEZONE,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(dateTime));
  }

  const [datePart, timePart] = normalized.split("T");
  const [, month, day] = datePart.split("-");
  const [hour, minute] = timePart.split(":").map(Number);
  const weekday = weekdayFromDate(datePart).slice(0, 3);
  const meridiem = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  const timeLabel =
    minute === 0 ? `${h12} ${meridiem}` : `${h12}:${String(minute).padStart(2, "0")} ${meridiem}`;
  return `${weekday} ${month}/${day}, ${timeLabel}`;
}

function resolveDayDate(dayOfWeek: string): string {
  const wantsNextWeek = /\bnext\b/i.test(dayOfWeek);
  const day = normalizeDayOfWeek(dayOfWeek);
  const dayIndex = getDayIndex(day);
  const now = studioDateParts();
  const currentDay = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    weekday: "long",
  })
    .format(new Date())
    .toLowerCase();
  const currentIndex = getDayIndex(currentDay);

  let daysAhead = dayIndex - currentIndex;
  if (daysAhead < 0) daysAhead += 7;
  if (wantsNextWeek && daysAhead === 0) daysAhead = 7;

  const base = new Date(`${now.year}-${now.month}-${now.day}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + daysAhead);
  let target = studioDateParts(base);
  let date = `${target.year}-${target.month}-${target.day}`;

  if (!wantsNextWeek && isStudioDateFullyPast(date, day)) {
    base.setUTCDate(base.getUTCDate() + 7);
    target = studioDateParts(base);
    date = `${target.year}-${target.month}-${target.day}`;
  }

  return date;
}

function normalizeDayOfWeek(dayOfWeek: string): string {
  const match = dayOfWeek.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!match) return dayOfWeek.toLowerCase().trim();
  return match[1];
}

function generateSlotsForDate(date: string, dayOfWeek: string): SlotInfo[] {
  const hours = getDayHours(dayOfWeek);
  if (!hours) return [];

  const openMin = parseClockToMinutes(hours.open);
  const closeMin = parseClockToMinutes(hours.close);
  const [year, month, day] = date.split("-");
  const slots: SlotInfo[] = [];

  for (let start = openMin; start + SLOT_MINUTES <= closeMin; start += SLOT_MINUTES) {
    const hour = Math.floor(start / 60);
    const minute = start % 60;
    const local = formatStudioDateTime(year, month, day, hour, minute);
    slots.push({
      dateTime: local,
      displayTime: formatDisplayTime(local),
      date,
    });
  }
  return slots;
}

async function listEventsOnDate(date: string) {
  const timeMin = `${date}T00:00:00Z`;
  const timeMax = `${date}T23:59:59Z`;
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

function eventBlocksSlot(
  event: { start?: { dateTime?: string | null }; end?: { dateTime?: string | null } },
  slotStart: string,
): boolean {
  if (!event.start?.dateTime || !event.end?.dateTime) return false;

  const slotDate = slotStart.slice(0, 10);
  const eventDate = event.start.dateTime.slice(0, 10);
  if (slotDate !== eventDate) return false;

  const slotStartMin = parseClockToMinutes(slotStart.slice(11, 16));
  const slotEndMin = slotStartMin + SLOT_MINUTES;
  const eventStartMin = studioMinutesFromDateTime(event.start.dateTime);
  const eventEndMin = studioMinutesFromDateTime(event.end.dateTime);
  return eventStartMin < slotEndMin && eventEndMin > slotStartMin;
}

async function getAvailableSlotsForDay(dayOfWeek: string): Promise<SlotInfo[]> {
  const day = normalizeDayOfWeek(dayOfWeek);
  const date = resolveDayDate(dayOfWeek);
  const allSlots = generateSlotsForDate(date, day);
  const events = await listEventsOnDate(date);
  return allSlots
    .filter((slot) => !isSessionSlotInPast(slot.dateTime))
    .filter((slot) => !events.some((event) => eventBlocksSlot(event, slot.dateTime)));
}

export async function getStudioBusinessHours(): Promise<{ timezone: string; hours: ReturnType<typeof getBusinessHours>; display: string }> {
  return {
    timezone: STUDIO_TIMEZONE,
    hours: getBusinessHours(),
    display: formatHoursForDisplay(),
  };
}

export async function listAvailableSlots(dayOfWeek: string): Promise<{
  dayOfWeek: string;
  date: string;
  slots: SlotInfo[];
  closed: boolean;
  reason?: string;
  openSlotCount: number;
  summary: string;
}> {
  const day = normalizeDayOfWeek(dayOfWeek);
  const date = resolveDayDate(dayOfWeek);

  if (isStudioHoliday(day)) {
    return {
      dayOfWeek: day,
      date,
      slots: [],
      closed: true,
      reason: "Sunday is a studio holiday — we are closed.",
      openSlotCount: 0,
      summary: "Closed — Sunday is a studio holiday.",
    };
  }

  const hours = getDayHours(day);
  if (!hours) {
    return {
      dayOfWeek: day,
      date,
      slots: [],
      closed: true,
      reason: "Studio is closed that day.",
      openSlotCount: 0,
      summary: `Closed on ${day}.`,
    };
  }

  const slots = await getAvailableSlotsForDay(day);
  const summary =
    slots.length > 0
      ? `${slots.length} openings on ${day} ${date}.`
      : `Fully booked on ${day} ${date}.`;

  return { dayOfWeek: day, date, slots, closed: false, openSlotCount: slots.length, summary };
}

export async function checkSlot(dayOfWeek: string, time: string): Promise<AvailabilityResult> {
  const day = normalizeDayOfWeek(dayOfWeek);
  const date = resolveDayDate(dayOfWeek);
  const requestedMin = parseTimeToMinutes(time);
  const hour = Math.floor(requestedMin / 60);
  const minute = requestedMin % 60;
  const [year, month, dayNum] = date.split("-");
  const dateTime = formatStudioDateTime(year, month, dayNum, hour, minute);

  const validation = validateSessionSlot(dateTime);
  const nearby = isStudioHoliday(day) ? [] : (await getAvailableSlotsForDay(dayOfWeek)).slice(0, 2);

  if (!validation.valid) {
    return {
      available: false,
      dateTime: "",
      date,
      displayTime: "",
      reason: validation.reason,
      nearbySlots: nearby,
    };
  }

  const events = await listEventsOnDate(date);
  const blocked = events.some((event) => eventBlocksSlot(event, dateTime));
  const available = await getAvailableSlotsForDay(dayOfWeek);

  if (blocked) {
    return {
      available: false,
      dateTime,
      date,
      displayTime: formatDisplayTime(dateTime),
      reason: "That session is already booked.",
      nearbySlots: available.filter((s) => s.dateTime !== dateTime).slice(0, 2),
    };
  }

  return {
    available: true,
    dateTime,
    date,
    displayTime: formatDisplayTime(dateTime),
    nearbySlots: available.filter((s) => s.dateTime !== dateTime).slice(0, 4),
  };
}

export async function bookSlot(
  dateTime: string,
  callerName: string,
  callerPhone: string,
): Promise<{ success: boolean; message: string; dateTime?: string; displayTime?: string }> {
  const validation = validateSessionSlot(dateTime);
  if (!validation.valid) {
    return { success: false, message: validation.reason ?? "That slot is not available." };
  }

  const slotCheck = await checkSlot(
    validation.dayOfWeek,
    formatTimeFromParts(validation.hour, validation.minute),
  );
  if (!slotCheck.available) {
    return {
      success: false,
      message: slotCheck.reason ?? "That slot is not available.",
    };
  }

  const endDateTime = addMinutesToDateTime(slotCheck.dateTime, SLOT_MINUTES);

  try {
    await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `Session: ${callerName}`,
        description: `Phone: ${callerPhone}\nBooked via receptionist`,
        start: { dateTime: slotCheck.dateTime, timeZone: STUDIO_TIMEZONE },
        end: { dateTime: endDateTime, timeZone: STUDIO_TIMEZONE },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar insert failed";
    console.error("[calendar] bookSlot insert failed:", message);
    return { success: false, message: "Could not book that slot on the calendar. Please try again." };
  }

  const verified = await bookingEventExists(callerName, slotCheck.dateTime, callerPhone);
  if (!verified) {
    console.error("[calendar] bookSlot insert not found after create:", slotCheck.dateTime);
    return { success: false, message: "Calendar booking could not be confirmed. Please try again." };
  }

  return {
    success: true,
    message: `Booked ${callerName} for ${slotCheck.displayTime}.`,
    dateTime: slotCheck.dateTime,
    displayTime: slotCheck.displayTime,
  };
}

function formatTimeFromParts(hour: number, minute: number): string {
  const meridiem = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 || 12;
  return minute === 0 ? `${hour12}${meridiem}` : `${hour12}:${String(minute).padStart(2, "0")}${meridiem}`;
}

function addMinutesToDateTime(dateTime: string, minutes: number): string {
  const [datePart, timePart] = dateTime.split("T");
  const [h, m] = timePart.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${datePart}T${minutesToClock(total)}:00`;
}

function eventMatchesCaller(
  event: { summary?: string | null; description?: string | null },
  callerName: string,
  callerPhone?: string,
): boolean {
  const summaryName = (event.summary ?? "").replace(/^Session:\s*/i, "").trim();
  if (namesMatch(callerName, summaryName)) {
    return true;
  }
  if (callerPhone) {
    const needle = callerPhone.replace(/\D/g, "");
    return needle.length > 0 && (event.description ?? "").replace(/\D/g, "").includes(needle);
  }
  return false;
}

/** Convert any calendar ISO datetime to studio-local tool format (YYYY-MM-DDTHH:mm:00). */
export function toStudioLocalDateTime(dateTime: string): string {
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(dateTime) || dateTime.endsWith("Z");
  if (!hasOffset) {
    return normalizeLocalDateTime(dateTime).slice(0, 19);
  }

  const parts = studioDateParts(new Date(dateTime));
  return formatStudioDateTime(parts.year, parts.month, parts.day, parts.hour, parts.minute);
}

export async function findBookings(
  callerName: string,
  callerPhone?: string,
): Promise<{
  bookings: Array<{
    dateTime: string;
    displayTime: string;
    sessionDate: string;
    sessionTime: string;
    summary: string;
  }>;
  count: number;
  summary: string;
}> {
  const now = studioDateParts();
  const timeMin = `${now.year}-${now.month}-${now.day}T00:00:00Z`;
  const end = addDaysToDateTime(`${now.year}-${now.month}-${now.day}T12:00:00`, 14);
  const timeMax = `${end.slice(0, 10)}T23:59:59Z`;

  const events = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    timeZone: STUDIO_TIMEZONE,
  });

  const bookings = (events.data.items ?? [])
    .filter((e) => e.start?.dateTime && eventMatchesCaller(e, callerName, callerPhone))
    .map((e) => {
      const local = toStudioLocalDateTime(e.start!.dateTime!);
      const displayTime = formatDisplayTime(local);
      return {
        dateTime: local,
        displayTime,
        sessionDate: local.slice(0, 10),
        sessionTime: displayTime,
        summary: e.summary ?? "Session",
      };
    });

  const summary =
    bookings.length === 0
      ? "No upcoming sessions found for that name."
      : bookings.length === 1
        ? `One session: ${bookings[0].displayTime}.`
        : `${bookings.length} upcoming sessions.`;

  return { bookings, count: bookings.length, summary };
}

export async function bookingEventExists(
  callerName: string,
  dateTime: string,
  callerPhone?: string,
): Promise<boolean> {
  const event = await findBookingEvent(callerName, dateTime, callerPhone);
  return Boolean(event?.id);
}

export type BookingEventSnapshot = {
  summary: string;
  description: string;
  startDateTime: string;
  endDateTime: string;
};

async function findBookingEvent(
  callerName: string,
  dateTime: string,
  callerPhone?: string,
): Promise<
  | {
      id?: string | null;
      summary?: string | null;
      description?: string | null;
      start?: { dateTime?: string | null };
      end?: { dateTime?: string | null };
    }
  | undefined
> {
  const targetLocal = toStudioLocalDateTime(dateTime);
  const events = await listEventsOnDate(studioDateFromDateTime(targetLocal));
  return events.find(
    (e) =>
      e.start?.dateTime &&
      toStudioLocalDateTime(e.start.dateTime) === targetLocal &&
      eventMatchesCaller(e, callerName, callerPhone),
  );
}

function snapshotFromEvent(event: {
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null };
  end?: { dateTime?: string | null };
}): BookingEventSnapshot | undefined {
  if (!event.start?.dateTime || !event.end?.dateTime) return undefined;
  return {
    summary: event.summary ?? "Session",
    description: event.description ?? "",
    startDateTime: event.start.dateTime,
    endDateTime: event.end.dateTime,
  };
}

export async function restoreBookingEvent(snapshot: BookingEventSnapshot): Promise<void> {
  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: snapshot.summary,
      description: snapshot.description,
      start: { dateTime: snapshot.startDateTime, timeZone: STUDIO_TIMEZONE },
      end: { dateTime: snapshot.endDateTime, timeZone: STUDIO_TIMEZONE },
    },
  });
}

export async function cancelBooking(
  callerName: string,
  dateTime: string,
  callerPhone?: string,
): Promise<{
  success: boolean;
  message: string;
  displayTime?: string;
  eventCallerName?: string;
  snapshot?: BookingEventSnapshot;
}> {
  const event = await findBookingEvent(callerName, dateTime, callerPhone);

  if (!event?.id) {
    return { success: false, message: "No booking found for that name and time." };
  }

  const displayTime = event.start?.dateTime
    ? formatDisplayTime(event.start.dateTime)
    : formatDisplayTime(dateTime);
  const snapshot = snapshotFromEvent(event);
  const eventCallerName = (event.summary ?? "").replace(/^Session:\s*/i, "").trim() || undefined;

  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event.id });

  return {
    success: true,
    message: `Cancelled session on ${displayTime}.`,
    displayTime,
    eventCallerName,
    snapshot,
  };
}

export async function rescheduleBooking(
  callerName: string,
  fromDateTime: string,
  toDateTime: string,
  callerPhone?: string,
): Promise<{ success: boolean; message: string; dateTime?: string; displayTime?: string }> {
  const oldEvent = await findBookingEvent(callerName, fromDateTime, callerPhone);

  if (!oldEvent?.id) {
    return { success: false, message: "No existing booking found for that name and time." };
  }

  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: oldEvent.id });
  return bookSlot(toDateTime, callerName, callerPhone ?? "");
}

// Re-export for tests
export { nextDateForDay };
