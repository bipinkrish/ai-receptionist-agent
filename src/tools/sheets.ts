import { sheets, SHEET_ID } from "../google-auth.js";
import { studioDateParts } from "../studio-time.js";

const CONTACTS_TAB = "Contacts";
const COLUMNS = ["Name", "Phone", "Last Call Date", "Topic", "Outcome", "Notes"] as const;

export interface ContactRow {
  name: string;
  phone: string;
  date: string;
  topic: string;
  outcome: string;
  notes: string;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
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
    range: `${CONTACTS_TAB}!A:F`,
  });
  return (res.data.values as string[][]) ?? [];
}

export async function findContact(phone: string): Promise<{ rowIndex: number; data: ContactRow } | null> {
  const rows = await readAllRows();
  const needle = normalizePhone(phone);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalizePhone(row[1] ?? "") === needle) {
      return {
        rowIndex: i + 1,
        data: {
          name: row[0] ?? "",
          phone: row[1] ?? "",
          date: row[2] ?? "",
          topic: row[3] ?? "",
          outcome: row[4] ?? "",
          notes: row[5] ?? "",
        },
      };
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
      range: `${CONTACTS_TAB}!A2:F`,
    });
  }
  return dataRows;
}

export async function logContact(contact: ContactRow): Promise<{ success: boolean; message: string }> {
  await ensureContactsHeader();

  const normalized = normalizeContact(contact);
  const existing = await findContact(normalized.phone);
  const notes = existing ? appendContactNotes(existing.data.notes, normalized) : normalized.notes;
  const values = [
    normalized.name,
    normalized.phone,
    normalized.date,
    normalized.topic,
    normalized.outcome,
    notes,
  ];

  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${CONTACTS_TAB}!A${existing.rowIndex}:F${existing.rowIndex}`,
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
    range: `${CONTACTS_TAB}!A:F`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  });
  return { success: true, message: `Logged new contact for ${contact.name}.` };
}

export async function ensureContactsHeader(): Promise<void> {
  await ensureContactsTab();

  const rows = await readAllRows();
  if (rows.length === 0 || rows[0]?.[0] !== COLUMNS[0]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${CONTACTS_TAB}!A1:F1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [COLUMNS as unknown as string[]] },
    });
  }
}
