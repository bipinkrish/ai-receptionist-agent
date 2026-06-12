import dotenv from "dotenv";
import { calendar, CALENDAR_ID, SHEET_ID, getServiceAccountEmail } from "../src/google-auth.js";
import { ensureContactsHeader } from "../src/tools/sheets.js";

dotenv.config();

async function main() {
  const email = await getServiceAccountEmail();
  console.log(`Service account: ${email ?? "(unknown — using ADC)"}`);
  console.log(`CALENDAR_ID: ${CALENDAR_ID || "(not set)"}`);
  console.log(`SHEET_ID: ${SHEET_ID || "(not set)"}\n`);

  if (CALENDAR_ID) {
    try {
      const cal = await calendar.calendars.get({ calendarId: CALENDAR_ID });
      console.log(`Calendar OK: ${cal.data.summary}`);
    } catch (err: unknown) {
      const status = (err as { code?: number }).code;
      if (status === 404) {
        console.error(
          `Calendar not found — share ${CALENDAR_ID} with ${email} as "Make changes to events".`,
        );
      } else {
        console.error("Calendar error:", err);
      }
    }
  }

  if (SHEET_ID) {
    try {
      await ensureContactsHeader();
      console.log('Sheet OK: "Contacts" tab ready with header row.');
    } catch (err: unknown) {
      const status = (err as { code?: number }).code;
      if (status === 403) {
        console.error(`Sheet access denied — share ${SHEET_ID} with ${email} as Editor.`);
      } else if (status === 404) {
        console.error("Spreadsheet not found — check SHEET_ID in .env.");
      } else {
        console.error("Sheet error:", err);
      }
    }
  }
}

main();
