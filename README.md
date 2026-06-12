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
| **JSON env var** | Set `GOOGLE_SERVICE_ACCOUNT_JSON` to the full file contents (good for cloud hosts) |
| **Application Default Credentials** | Omit file/inline vars; run `gcloud auth application-default login` locally |

For production on GCP, [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity) is the usual approach — no key file at all.

## Install

```bash
npm install
```

## Seed test data

```bash
npm run seed
```

## Reset (clear calendar + contacts)

Removes **all** calendar events and all Contacts rows (keeps the header):

```bash
npm run reset
npm run seed   # optional — repopulate test data
```

## Test tools standalone

```bash
npm run verify:google    # confirm calendar + sheet access
npm run test:calendar   # listAvailableSlots / checkSlot against live calendar
npm run test:sheets     # append/update a test contact row
```

## Run the chat

**CLI:**
```bash
npm run chat
```

**Web UI (showcase):**
```bash
npm run ui
```
Open http://localhost:3000 — set `PORT` in `.env` to change the port.


### 1. Host the API


1. Create a **Web Service** from this repo.
2. Set **Start command** to `npm run ui`.
3. Add environment variables (see table below).
4. Set `CORS_ORIGIN` to your GitHub Pages URL, e.g. `https://YOUR_USER.github.io` (or `https://YOUR_USER.github.io/REPO_NAME` for project pages).
5. Copy the public API URL.

### 2. Enable GitHub Pages

1. Repo **Settings → Pages → Build and deployment → Source**: **GitHub Actions**.
2. Add repository secrets (**Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Value |
|--------|--------|
| `API_BASE_URL` | Your hosted API URL (no trailing slash) |

Push to `main` (or run the **Deploy UI to GitHub Pages** workflow manually). The site will be at `https://YOUR_USER.github.io/REPO_NAME/`.

The GitHub workflow only deploys static HTML — **no Google or Groq secrets belong in GitHub**. Those go on your API host.

### Google service account JSON on the API host


1. Open `service-account.json` in a text editor.
2. Copy the **entire file** (from `{` through `}`).
3. In Host → your service → **Environment**:
   - Key: `GOOGLE_SERVICE_ACCOUNT_JSON`
   - Value: paste the raw JSON

The app reads `GOOGLE_SERVICE_ACCOUNT_JSON` directly (`src/google-auth.ts`).

**Alternative — split fields** (if your host prefers separate vars):

| Variable | Value |
|----------|--------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `receptionist@project.iam.gserviceaccount.com` |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Full key including `-----BEGIN PRIVATE KEY-----` lines; use `\n` for line breaks in a single line |

### API env vars checklist (hosting)

| Variable | Required |
|----------|----------|
| `GROQ_API_KEY` | Yes |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes (or email + private key) |
| `CALENDAR_ID` | Yes |
| `SHEET_ID` | Yes |
| `STUDIO_TIMEZONE` | Yes |
| `CORS_ORIGIN` | Yes when UI is on GitHub Pages |

## Project structure

```
src/
  chat.ts           CLI entrypoint
  server.ts         Web UI server
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

## Booking model & timezone

- Sessions are **30 minutes**, **one person per slot**, within business hours:
  - Mon–Fri 6am–8pm, Sat 8am–2pm, **Sun closed (holiday)**
- There are no preset class types — tools compute open slots from the calendar.
- All times use **STUDIO_TIMEZONE** from `.env` (default `America/Los_Angeles`).
- The agent must use `listAvailableSlots`, `checkSlot`, and `bookSlot` — never invent times.
