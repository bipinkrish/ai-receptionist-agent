/**
 * Seeds sample 30-minute booked sessions and matching Contacts sheet rows.
 * All times are validated against business hours before writing.
 */

import dotenv from "dotenv";
import { calendar, CALENDAR_ID, SHEET_ID, getServiceAccountEmail } from "../src/google-auth.js";
import { SLOT_MINUTES, validateSessionSlot } from "../src/business-hours.js";
import { STUDIO_TIMEZONE, nextWeekdayDateTime, studioDateParts } from "../src/studio-time.js";
import { ensureContactsHeader, logContact } from "../src/tools/sheets.js";
import { toStudioLocalDateTime } from "../src/tools/calendar.js";

dotenv.config();

function addMinutes(dateTime: string, minutes: number): string {
  const [datePart, timePart] = dateTime.split("T");
  const [h, m] = timePart.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const endH = Math.floor(total / 60);
  const endM = total % 60;
  return `${datePart}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00`;
}

function todayDate(): string {
  const now = studioDateParts();
  return `${now.year}-${now.month}-${now.day}`;
}

const bookings = [
  { name: "Alice Walker", phone: "555-0001", start: nextWeekdayDateTime(4, 18, 0) },
  { name: "Bob Martinez", phone: "555-0002", start: nextWeekdayDateTime(4, 18, 30) },
  { name: "Carol Nguyen", phone: "555-0003", start: nextWeekdayDateTime(2, 10, 0) },
  { name: "Dan Cooper", phone: "555-0004", start: nextWeekdayDateTime(6, 9, 0) },
];

async function seedCalendar() {
  for (const booking of bookings) {
    const validation = validateSessionSlot(booking.start);
    if (!validation.valid) {
      throw new Error(`Seed slot for ${booking.name} invalid: ${validation.reason}`);
    }

    const end = addMinutes(booking.start, SLOT_MINUTES);

    try {
      const res = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary: `Session: ${booking.name}`,
          description: `Phone: ${booking.phone}\nSeeded test booking`,
          start: { dateTime: booking.start, timeZone: STUDIO_TIMEZONE },
          end: { dateTime: end, timeZone: STUDIO_TIMEZONE },
        },
      });
      console.log(`Calendar: ${res.data.summary} (${res.data.start?.dateTime})`);
    } catch (err: unknown) {
      const status = (err as { code?: number }).code;
      if (status === 404) {
        const email = await getServiceAccountEmail();
        console.error(
          `Calendar not found — share ${CALENDAR_ID} with ${email} as "Make changes to events".`,
        );
        process.exit(1);
      }
      throw err;
    }
  }
}

async function seedSheets() {
  await ensureContactsHeader();
  const date = todayDate();

  for (const booking of bookings) {
    const sessionDate = booking.start.slice(0, 10);
    const local = toStudioLocalDateTime(booking.start);
    const [, timePart] = local.split("T");
    const [h, m] = timePart.split(":").map(Number);
    const meridiem = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    const sessionTime = m === 0 ? `${h12} ${meridiem}` : `${h12}:${String(m).padStart(2, "0")} ${meridiem}`;

    const result = await logContact({
      name: booking.name,
      phone: booking.phone,
      date,
      topic: "seed",
      outcome: "booked",
      notes: `Seeded with calendar session at ${booking.start}`,
      sessionDate,
      sessionTime,
    });
    console.log(`Contacts: ${result.message}`);
  }
}

async function seed() {
  if (!CALENDAR_ID) {
    console.error("CALENDAR_ID is not set in .env");
    process.exit(1);
  }
  if (!SHEET_ID) {
    console.error("SHEET_ID is not set in .env");
    process.exit(1);
  }

  console.log("Seeding calendar (business-hours validated)...\n");
  await seedCalendar();

  console.log("\nSeeding Contacts sheet...\n");
  try {
    await seedSheets();
  } catch (err: unknown) {
    const status = (err as { code?: number }).code;
    if (status === 403 || status === 404) {
      const email = await getServiceAccountEmail();
      console.error(`Sheet error — share ${SHEET_ID} with ${email} as Editor.`);
      process.exit(1);
    }
    throw err;
  }

  console.log(`\nDone. ${bookings.length} calendar slots + ${bookings.length} contact rows.`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
