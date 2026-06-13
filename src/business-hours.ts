import { STUDIO_TIMEZONE, studioDateParts } from "./studio-time.js";

export const SLOT_MINUTES = 30;

export interface DayHours {
  open: string;
  close: string;
}

/** Sunday is a studio holiday — always closed. */
const STUDIO_HOLIDAYS = new Set(["sunday"]);

const DEFAULT_HOURS: Record<string, DayHours | null> = {
  monday: { open: "06:00", close: "20:00" },
  tuesday: { open: "06:00", close: "20:00" },
  wednesday: { open: "06:00", close: "20:00" },
  thursday: { open: "06:00", close: "20:00" },
  friday: { open: "06:00", close: "20:00" },
  saturday: { open: "08:00", close: "14:00" },
  sunday: null,
};

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type DayName = (typeof DAY_NAMES)[number];

export interface SlotValidation {
  valid: boolean;
  reason?: string;
  dayOfWeek: string;
  date: string;
  hour: number;
  minute: number;
}

export function getBusinessHours(): Record<string, DayHours | null> {
  return { ...DEFAULT_HOURS };
}

export function getDayHours(dayOfWeek: string): DayHours | null {
  const day = dayOfWeek.toLowerCase();
  if (STUDIO_HOLIDAYS.has(day)) return null;
  return DEFAULT_HOURS[day] ?? null;
}

export function isStudioHoliday(dayOfWeek: string): boolean {
  return STUDIO_HOLIDAYS.has(dayOfWeek.toLowerCase());
}

export function getDayIndex(dayOfWeek: string): number {
  const idx = DAY_NAMES.indexOf(dayOfWeek.toLowerCase() as DayName);
  if (idx === -1) throw new Error(`Invalid day: ${dayOfWeek}`);
  return idx;
}

export function weekdayFromDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    weekday: "long",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .toLowerCase();
}

export function normalizeLocalDateTime(dateTime: string): string {
  return dateTime.replace(/([+-]\d{2}:\d{2}|Z)$/, "").slice(0, 19);
}

function studioTodayDate(): string {
  const now = studioDateParts();
  return `${now.year}-${now.month}-${now.day}`;
}

/** True when the session start is not in the future (studio timezone). */
export function isSessionSlotInPast(dateTime: string): boolean {
  const normalized = normalizeLocalDateTime(dateTime);
  const [date, timePart] = normalized.split("T");
  const [hour, minute] = timePart.split(":").map(Number);
  const today = studioTodayDate();

  if (date < today) return true;
  if (date > today) return false;

  const now = studioDateParts();
  const startMin = hour * 60 + minute;
  const nowMin = now.hour * 60 + now.minute;
  return startMin <= nowMin;
}

/** True when studio local time is past closing for this calendar date. */
export function isStudioDateFullyPast(date: string, dayOfWeek: string): boolean {
  const today = studioTodayDate();
  if (date < today) return true;
  if (date > today) return false;

  const hours = getDayHours(dayOfWeek);
  if (!hours) return true;

  const now = studioDateParts();
  const closeMin = parseClockToMinutes(hours.close);
  const nowMin = now.hour * 60 + now.minute;
  return nowMin >= closeMin;
}

/** Validates a 30-min session start time against business hours and holidays. */
export function validateSessionSlot(dateTime: string): SlotValidation {
  const normalized = normalizeLocalDateTime(dateTime);
  const [date, timePart] = normalized.split("T");
  const dayOfWeek = weekdayFromDate(date);
  const [hour, minute] = timePart.split(":").map(Number);
  const startMin = hour * 60 + minute;

  if (isSessionSlotInPast(normalized)) {
    return {
      valid: false,
      reason: "That time is in the past — please choose a future date and time.",
      dayOfWeek,
      date,
      hour,
      minute,
    };
  }

  const hours = getDayHours(dayOfWeek);

  if (!hours) {
    const reason = isStudioHoliday(dayOfWeek)
      ? "Sunday is a studio holiday — we are closed."
      : `Studio is closed on ${dayOfWeek}.`;
    return { valid: false, reason, dayOfWeek, date, hour, minute };
  }

  const openMin = parseClockToMinutes(hours.open);
  const closeMin = parseClockToMinutes(hours.close);

  if (startMin < openMin || startMin + SLOT_MINUTES > closeMin) {
    return {
      valid: false,
      reason: `Outside business hours for ${dayOfWeek} (${hours.open}–${hours.close}).`,
      dayOfWeek,
      date,
      hour,
      minute,
    };
  }

  if (startMin % SLOT_MINUTES !== 0) {
    return {
      valid: false,
      reason: "Sessions must start on the hour or half-hour.",
      dayOfWeek,
      date,
      hour,
      minute,
    };
  }

  return { valid: true, dayOfWeek, date, hour, minute };
}

export function formatHoursForDisplay(): string {
  const lines = DAY_NAMES.map((day) => {
    const hours = DEFAULT_HOURS[day];
    if (!hours) {
      const label = isStudioHoliday(day) ? "Closed (holiday)" : "Closed";
      return `${day[0].toUpperCase()}${day.slice(1)}: ${label}`;
    }
    return `${day[0].toUpperCase()}${day.slice(1)}: ${format12h(hours.open)} – ${format12h(hours.close)}`;
  });
  return lines.join("\n");
}

function format12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const meridiem = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 || 12;
  return m === 0 ? `${hour12}${meridiem}` : `${hour12}:${String(m).padStart(2, "0")}${meridiem}`;
}

export function parseTimeToMinutes(time: string): number {
  const match = time.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) throw new Error(`Invalid time: ${time}`);
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

export function parseClockToMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export { STUDIO_TIMEZONE, DAY_NAMES };