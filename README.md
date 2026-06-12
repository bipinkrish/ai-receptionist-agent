# Solstice Pilates AI Receptionist

Phase 1 text-chat agent for Solstice Pilates. Checks class availability, books/reschedules via Google Calendar, logs callers to Google Sheets, and escalates out-of-scope requests.

## Prerequisites

- Node.js 18+
- A [Groq](https://console.groq.com/) API key
- A Google Cloud project with **Calendar API** and **Sheets API** enabled
- A service account JSON key file

## Google Cloud setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Calendar API** and **Google Sheets API**.
3. Create a **Service Account** (IAM & Admin → Service Accounts → Create).
4. Create a JSON key for the service account and save it as `service-account.json` in this directory.
5. Copy the service account email (e.g. `receptionist@project.iam.gserviceaccount.com`).

### Share Calendar

1. Open Google Calendar → Settings → your studio calendar (or create one).
2. Under "Share with specific people", add the service account email with **Make changes to events** permission.
3. Copy the Calendar ID (Settings → Integrate calendar → Calendar ID).

### Share Sheet

1. Create a Google Sheet (or use an existing one).
2. Share the spreadsheet with the service account email as **Editor** (sharing alone is enough — a **Contacts** tab is created automatically on first use).
3. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`

## Environment variables

Copy `.env.example` to `.env` and fill in values:

```
GROQ_API_KEY=...
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./service-account.json
STUDIO_TIMEZONE=America/Los_Angeles
CALENDAR_ID=your_calendar_id@group.calendar.google.com
SHEET_ID=your_google_sheet_id
```

### Google auth options

You do **not** have to use a JSON file. Pick one:

| Method | Setup |
|--------|--------|
| **JSON file** (default) | `GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./service-account.json` |
| **Inline env vars** | Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (use `\n` for newlines in the key) |
| **Application Default Credentials** | Omit file/inline vars; run `gcloud auth application-default login` locally |

For production on GCP, [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity) is the usual approach — no key file at all.

## Install

```bash
npm install
```

## Seed test calendar events

Creates sample classes for the next week (full 6pm Reformer, open 7pm Reformer, etc.):

```bash
npm run seed
```

Events use this capacity convention in the **description** field:

```
Capacity: 6/8
Attendee: Jane Doe (555-1234)
```

`6/8` = 6 spots taken, 8 max.

## Test tools standalone

```bash
npm run verify:google    # confirm calendar access + list visible calendars
npm run test:calendar   # checkAvailability against live calendar
npm run test:sheets     # append/update a test contact row
```

## Run the chat

```bash
npm run chat
```

Type messages at the `You:` prompt. Type `exit` to quit.

## Project structure

```
src/
  chat.ts           CLI entrypoint
  agent.ts          Groq tool-calling loop
  policy.ts         System prompt
  google-auth.ts    Service account clients
  tools/
    index.ts        Tool schemas + dispatcher
    calendar.ts     Availability, booking, reschedule
    sheets.ts       Contact logging
scripts/
  seed-calendar.ts  Test event seeder
```

## Capacity & timezone notes

- All class times use **STUDIO_TIMEZONE** from `.env` (default `America/Los_Angeles`).
- Class fullness is determined by the `Capacity: X/Y` line in each event's description.
- Bookings append an `Attendee: Name (phone)` line and increment the booked count.
