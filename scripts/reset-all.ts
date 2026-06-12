/**
 * Deletes all events on CALENDAR_ID and clears all Contacts sheet rows (keeps header).
 */

import dotenv from "dotenv";
import { calendar, CALENDAR_ID, SHEET_ID, getServiceAccountEmail } from "../src/google-auth.js";
import { clearContactsSheet } from "../src/tools/sheets.js";

dotenv.config();

async function clearCalendar(): Promise<number> {
  let deleted = 0;
  let pageToken: string | undefined;

  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      singleEvents: true,
      maxResults: 250,
      pageToken,
      timeMin: "2000-01-01T00:00:00Z",
      timeMax: "2100-01-01T00:00:00Z",
    });

    for (const event of res.data.items ?? []) {
      if (!event.id) continue;
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event.id });
      deleted++;
      console.log(`Deleted: ${event.summary ?? event.id}`);
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return deleted;
}

async function reset() {
  if (!CALENDAR_ID || !SHEET_ID) {
    console.error("Set CALENDAR_ID and SHEET_ID in .env");
    process.exit(1);
  }

  try {
    console.log("Clearing calendar events...\n");
    const eventsDeleted = await clearCalendar();
    console.log(`\nCalendar: ${eventsDeleted} event(s) deleted.`);

    console.log("\nClearing Contacts sheet...\n");
    const rowsCleared = await clearContactsSheet();
    console.log(`Contacts: ${rowsCleared} row(s) cleared (header kept).`);

    console.log("\nDone. Run npm run seed to repopulate test data.");
  } catch (err: unknown) {
    const status = (err as { code?: number }).code;
    if (status === 403 || status === 404) {
      const email = await getServiceAccountEmail();
      console.error(`Access error — ensure calendar and sheet are shared with ${email}.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

reset();
