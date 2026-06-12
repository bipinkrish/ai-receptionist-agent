import dotenv from "dotenv";

dotenv.config();

export const STUDIO_TIMEZONE = process.env.STUDIO_TIMEZONE ?? "America/Los_Angeles";

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

export function studioDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatStudioDateTime(year: string, month: string, day: string, hour: number, minute: number): string {
  return `${year}-${month}-${day}T${pad(hour)}:${pad(minute)}:00`;
}

function getStudioWeekdayIndex(date = new Date()): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    weekday: "long",
  })
    .format(date)
    .toLowerCase();
  return DAY_MAP[weekday];
}

export function nextWeekdayDateTime(dayIndex: number, hour: number, minute: number): string {
  const now = studioDateParts();
  const currentDay = getStudioWeekdayIndex();

  let daysAhead = dayIndex - currentDay;
  if (daysAhead < 0) daysAhead += 7;
  if (daysAhead === 0 && (now.hour > hour || (now.hour === hour && now.minute >= minute))) {
    daysAhead = 7;
  }

  const base = new Date(`${now.year}-${now.month}-${now.day}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + daysAhead);

  const target = studioDateParts(base);
  return formatStudioDateTime(target.year, target.month, target.day, hour, minute);
}

/** Add days to an existing studio-local dateTime string (YYYY-MM-DDTHH:mm:ss). */
export function addDaysToDateTime(dateTime: string, days: number): string {
  const [datePart, timePart] = dateTime.split("T");
  const base = new Date(`${datePart}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  const target = studioDateParts(base);
  return `${target.year}-${target.month}-${target.day}T${timePart}`;
}

export function addHoursToDateTime(dateTime: string, hours: number): string {
  const [datePart, timePart] = dateTime.split("T");
  const [h, m, s] = timePart.split(":").map((v) => parseInt(v, 10));
  const endHour = h + hours;
  return `${datePart}T${pad(endHour)}:${pad(m)}:${pad(s || 0)}`;
}

export function parseTimeToHourMinute(time: string): { hour: number; minute: number } {
  const match = time.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) throw new Error(`Invalid time format: ${time}`);
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour <= 7) hour += 12;
  return { hour, minute };
}

export function nextDateForDay(dayOfWeek: string, hour: number, minute: number): string {
  const targetDay = DAY_MAP[dayOfWeek.toLowerCase()];
  if (targetDay === undefined) throw new Error(`Invalid day: ${dayOfWeek}`);
  return nextWeekdayDateTime(targetDay, hour, minute);
}
