import { readFileSync } from "fs";
import { resolve } from "path";
import { google } from "googleapis";
import type { JWTInput } from "google-auth-library";
import dotenv from "dotenv";

dotenv.config();

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
];

function loadCredentials(): JWTInput | undefined {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (email && privateKey) {
    return {
      client_email: email,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    return JSON.parse(json) as JWTInput;
  }

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (keyPath) {
    return JSON.parse(readFileSync(resolve(keyPath), "utf-8"));
  }

  // Falls back to Application Default Credentials (ADC):
  // run `gcloud auth application-default login` locally, or use workload identity in GCP.
  return undefined;
}

const credentials = loadCredentials();

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

export const calendar = google.calendar({ version: "v3", auth });
export const sheets = google.sheets({ version: "v4", auth });

export const CALENDAR_ID = process.env.CALENDAR_ID ?? "";
export const SHEET_ID = process.env.SHEET_ID ?? "";

export async function getServiceAccountEmail(): Promise<string | undefined> {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  }
  if (credentials && "client_email" in credentials) {
    return credentials.client_email;
  }
  const client = await auth.getClient();
  if ("email" in client && typeof client.email === "string") {
    return client.email;
  }
  return undefined;
}
