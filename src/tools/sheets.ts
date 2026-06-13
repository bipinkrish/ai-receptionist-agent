import { sheets, SHEET_ID } from "../google-auth.js";
import { namesMatch } from "./caller-identity.js";
import { studioDateParts } from "../studio-time.js";

const CONTACTS_TAB = "Contacts";
const COLUMNS = [
  "Name",
  "Phone",
  "Last Call Date",
  "Topic",
  "Outcome",
  "Notes",
  "Session Date",
  "Session Time",
] as const;

export interface ContactRow {
  name: string;
  phone: string;
  date: string;
  topic: string;
  outcome: string;
  notes: string;
  sessionDate?: string;
  sessionTime?: string;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function normalizeContactName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function rowToContact(row: string[]): ContactRow {
  return {
    name: row[0] ?? "",
    phone: row[1] ?? "",
    date: row[2] ?? "",
    topic: row[3] ?? "",
    outcome: row[4] ?? "",
    notes: row[5] ?? "",
    sessionDate: row[6] ?? "",
    sessionTime: row[7] ?? "",
  };
}

async function ensureContactsTab(): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "sheets.properties.title",
  });

  const exists = meta.data.sheets?.some((s) => s.properties?.title === CONTACTS_TAB);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: CONTACTS_TAB } } }],
    },
  });
}

async function readAllRows(): Promise<string[][]> {
  await ensureContactsTab();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${CONTACTS_TAB}!A:H`,
  });
  return (res.data.values as string[][]) ?? [];
}

export async function findContactByName(
  name: string,
): Promise<{ rowIndex: number; data: ContactRow } | null> {
  const rows = await readAllRows();
  const needle = normalizeContactName(name);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowName = row[0] ?? "";
    if (normalizeContactName(rowName) === needle || namesMatch(name, rowName)) {
      return { rowIndex: i + 1, data: rowToContact(row) };
    }
  }
  return null;
}

export async function findContact(phone: string): Promise<{ rowIndex: number; data: ContactRow } | null> {
  const rows = await readAllRows();
  const needle = normalizePhone(phone);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalizePhone(row[1] ?? "") === needle) {
      return { rowIndex: i + 1, data: rowToContact(row) };
    }
  }
  return null;
}

function todayStudioDate(): string {
  const now = studioDateParts();
  return `${now.year}-${now.month}-${now.day}`;
}

function normalizeContactDate(date: string): string {
  const trimmed = date.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower === "today" || lower === "today's date" || lower.includes("today")) {
    return todayStudioDate();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return todayStudioDate();
}

function normalizeContact(contact: ContactRow): ContactRow {
  return {
    ...contact,
    date: normalizeContactDate(contact.date),
    notes: contact.notes.trim(),
    sessionDate: contact.sessionDate?.trim() ?? "",
    sessionTime: contact.sessionTime?.trim() ?? "",
  };
}

function appendContactNotes(existingNotes: string, contact: ContactRow): string {
  const entry = `[${contact.date}] ${contact.topic}: ${contact.notes}`;
  const prior = existingNotes.trim();
  if (prior.includes(entry)) return prior;
  return prior ? `${prior}\n${entry}` : entry;
}

export async function clearContactsSheet(): Promise<number> {
  await ensureContactsHeader();
  const rows = await readAllRows();
  const dataRows = Math.max(0, rows.length - 1);

  if (dataRows > 0) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${CONTACTS_TAB}!A2:H`,
    });
  }
  return dataRows;
}

const BOOKING_LOG_TOPICS = new Set([
  "session booking",
  "session cancellation",
  "session reschedule",
]);

export async function logContact(
  contact: ContactRow,
  options?: { allowBookingTopic?: boolean },
): Promise<{ success: boolean; message: string }> {
  await ensureContactsHeader();

  const normalized = normalizeContact(contact);
  if (!options?.allowBookingTopic && BOOKING_LOG_TOPICS.has(normalized.topic.toLowerCase())) {
    return {
      success: false,
      message:
        "Booking status is logged automatically by bookSlot, cancelBooking, or rescheduleBooking — use logContact only for general call notes.",
    };
  }

  const existingByPhone = normalized.phone ? await findContact(normalized.phone) : null;
  const existing = existingByPhone ?? (await findContactByName(normalized.name));
  const phone = existing?.data.phone || normalized.phone;

  const sessionDate =
    normalized.topic.toLowerCase() === "session cancellation"
      ? ""
      : normalized.sessionDate || existing?.data.sessionDate || "";
  const sessionTime =
    normalized.topic.toLowerCase() === "session cancellation"
      ? ""
      : normalized.sessionTime || existing?.data.sessionTime || "";

  const notes = existing ? appendContactNotes(existing.data.notes, normalized) : normalized.notes;
  const values = [
    normalized.name,
    phone,
    normalized.date,
    normalized.topic,
    normalized.outcome,
    notes,
    sessionDate,
    sessionTime,
  ];

  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${CONTACTS_TAB}!A${existing.rowIndex}:H${existing.rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    return {
      success: true,
      message: `Updated contact record for ${contact.name} (notes appended).`,
    };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${CONTACTS_TAB}!A:H`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  });
  return { success: true, message: `Logged new contact for ${contact.name}.` };
}

export async function ensureContactsHeader(): Promise<void> {
  await ensureContactsTab();

  const rows = await readAllRows();
  const header = rows[0] ?? [];
  const needsHeader = header.length === 0 || header[0] !== COLUMNS[0];
  const needsSessionCols = header.length < COLUMNS.length || header[6] !== COLUMNS[6];

  if (needsHeader || needsSessionCols) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${CONTACTS_TAB}!A1:H1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [COLUMNS as unknown as string[]] },
    });
  }
}
