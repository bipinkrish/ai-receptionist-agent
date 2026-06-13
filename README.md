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

## Scripts

| Command | Use |
|---------|-----|
| `npm run ui` | **Local dev** — API + serves `public/index.html` at http://localhost:3000 |
| `npm run tools` | **Backend (Koyeb)** — API only, no static files |
| `npm run chat` | CLI text chat |
| `npm run vapi:assistant` | Create/update Vapi assistant (run once after backend is live) |
| `npm run build:pages` | Build static HTML for GitHub Pages (used by CI) |

**Local dev:**
```bash
npm run ui
```
Open http://localhost:3000 — choose **Text** or **Voice**.

**Backend routes** (both `ui` and `tools`):

| Route | Purpose |
|-------|---------|
| `POST /api/session`, `/api/chat` | Text chat |
| `POST /vapi/tools` | Vapi tool webhook |
| `GET /health` | Health check |

## Voice (Vapi web call)

Phase 2 adds browser voice via [Vapi](https://vapi.ai). Vapi handles STT, Groq LLM, and TTS; tool calls hit the same backend as text chat (`POST /vapi/tools`).

### Setup

1. Add to `.env`:
   ```
   VAPI_PRIVATE_KEY=...
   VAPI_PUBLIC_KEY=...
   API_BASE_URL=https://your-app.koyeb.app   # after deploying backend
   ```

2. Deploy backend with `npm run tools` on Koyeb (see Deploy section), then create the Vapi assistant:
   ```bash
   npm run vapi:assistant
   ```
   Uses `API_BASE_URL/vapi/tools` as the tool webhook. Copy the printed ID → `VAPI_ASSISTANT_ID`.

3. Re-run `npm run vapi:assistant` after setting `VAPI_ASSISTANT_ID` to PATCH instead of create.

4. Open the site (local or GitHub Pages) and pick **Voice**.

## Deploy (Koyeb backend + GitHub Pages frontend)

```
GitHub Pages (static public/index.html)
        │
        ├── Text  → POST /api/chat  ──┐
        └── Voice → Vapi cloud       │
                                     ▼
                          Koyeb: npm run tools
                          (API only, no HTML)
```

### Step 1 — Backend on Koyeb

1. Create an app from this repo on [Koyeb](https://www.koyeb.com).
2. **Run command:** `npm run tools`
3. Add environment variables:

| Variable | Value |
|----------|--------|
| `GROQ_API_KEY` | Your Groq key |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full service account JSON |
| `CALENDAR_ID` | Your calendar ID |
| `SHEET_ID` | Your sheet ID |
| `STUDIO_TIMEZONE` | e.g. `America/Los_Angeles` |
| `CORS_ORIGIN` | `https://YOUR_USER.github.io` |

4. Deploy and copy the public URL (e.g. `https://solstice-receptionist-xxx.koyeb.app`).

### Step 2 — Vapi assistant

On your machine, set `API_BASE_URL` to the Koyeb URL in `.env`, then:

```bash
npm run vapi:assistant
```

Copy the printed assistant ID. Add to:
- `.env` locally as `VAPI_ASSISTANT_ID`
- Koyeb env vars (optional, not used at runtime)
- GitHub secrets (Step 3)

Re-run `npm run vapi:assistant` after setting `VAPI_ASSISTANT_ID` to update instead of create.

### Step 3 — Frontend on GitHub Pages

1. Repo **Settings → Pages → Build and deployment → Source:** **GitHub Actions**.
2. Add repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|--------|--------|
| `API_BASE_URL` | Koyeb URL, no trailing slash |
| `VAPI_PUBLIC_KEY` | Vapi public key |
| `VAPI_ASSISTANT_ID` | From Step 2 |

3. Push to `main`. The workflow runs `build:pages`, injects secrets into `public/index.html`, and deploys the static file.

Site URL: `https://YOUR_USER.github.io/REPO_NAME/`

No Google/Groq secrets in GitHub — those stay on Koyeb only.

## Project structure

```
public/
  index.html              Text + Voice UI (deployed to GitHub Pages)
src/
  chat.ts                 CLI entrypoint
  server.ts               All backend routes (text API + Vapi tools)
  agent.ts                Groq tool-calling loop
  policy.ts               System prompt
  google-auth.ts          Service account clients
  vapi/
    create-assistant.ts   One-off Vapi assistant setup
    handle-tool-calls.ts  Vapi webhook handler
    tools.ts              Tool defs → Vapi format
  tools/
    index.ts              Tool schemas + runTool()
    calendar.ts           Availability, booking, reschedule
    sheets.ts             Contact logging
scripts/
  prepare-pages.mjs       Builds static UI for GitHub Pages
  seed-calendar.ts        Test event seeder
```

## Booking model & timezone

- Sessions are **30 minutes**, **one person per slot**, within business hours:
  - Mon–Fri 6am–8pm, Sat 8am–2pm, **Sun closed (holiday)**
- There are no preset class types — tools compute open slots from the calendar.
- All times use **STUDIO_TIMEZONE** from `.env` (default `America/Los_Angeles`).
- The agent must use `listAvailableSlots`, `checkSlot`, and `bookSlot` — never invent times.
