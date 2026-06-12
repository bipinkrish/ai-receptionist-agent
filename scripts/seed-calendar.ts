/**
 * Seeds test events on CALENDAR_ID for the next 7 days.
 *
 * Capacity convention (in event description):
 *   "Capacity: 6/8" means 6 booked out of 8 max spots.
 *   Attendee lines: "Attendee: Name (phone)"
 */

import dotenv from "dotenv";
import { calendar, CALENDAR_ID, getServiceAccountEmail } from "../src/google-auth.js";
import {
  STUDIO_TIMEZONE,
  addDaysToDateTime,
  addHoursToDateTime,
  nextWeekdayDateTime,
} from "../src/studio-time.js";

dotenv.config();

const events = [
  {
    summary: "6pm Reformer - Thursday",
    start: nextWeekdayDateTime(4, 18, 0),
    description:
      "Capacity: 8/8\nAttendee: Alice (555-0001)\nAttendee: Bob (555-0002)\nAttendee: Carol (555-0003)\nAttendee: Dan (555-0004)\nAttendee: Eve (555-0005)\nAttendee: Frank (555-0006)\nAttendee: Grace (555-0007)\nAttendee: Hank (555-0008)",
  },
  {
    summary: "7pm Reformer - Thursday",
    start: nextWeekdayDateTime(4, 19, 0),
    description:
      "Capacity: 6/8\nAttendee: Iris (555-0009)\nAttendee: Jack (555-0010)\nAttendee: Kate (555-0011)\nAttendee: Leo (555-0012)\nAttendee: Mia (555-0013)\nAttendee: Noah (555-0014)",
  },
  {
    summary: "6pm Mat Pilates - Monday",
    start: nextWeekdayDateTime(1, 18, 0),
    description:
      "Capacity: 3/10\nAttendee: Olivia (555-0015)\nAttendee: Paul (555-0016)\nAttendee: Quinn (555-0017)",
  },
  {
    summary: "7pm Reformer - Saturday",
    start: addDaysToDateTime(nextWeekdayDateTime(6, 19, 0), 3),
    description: "Capacity: 2/8\nAttendee: Rita (555-0018)\nAttendee: Sam (555-0019)",
  },
];

async function seed() {
  if (!CALENDAR_ID) {
    console.error("CALENDAR_ID is not set in .env");
    process.exit(1);
  }

  for (const event of events) {
    const end = addHoursToDateTime(event.start, 1);

    try {
      const res = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start, timeZone: STUDIO_TIMEZONE },
          end: { dateTime: end, timeZone: STUDIO_TIMEZONE },
        },
      });
      console.log(`Created: ${res.data.summary} (${res.data.start?.dateTime})`);
    } catch (err: unknown) {
      const status = (err as { code?: number }).code;
      if (status === 404) {
        const email = await getServiceAccountEmail();
        console.error(
          `Failed to create "${event.summary}" — calendar not found (404).\n` +
            `Share calendar ${CALENDAR_ID} with ${email} as "Make changes to events".\n` +
            "Run `npm run verify:google` for more detail.",
        );
        process.exit(1);
      }
      throw err;
    }
  }

  console.log(`\nDone (${STUDIO_TIMEZONE}). Check Google Calendar for Capacity lines in descriptions.`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
