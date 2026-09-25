import { OAuth2Client } from "google-auth-library";
import { oauth2 } from "@googleapis/oauth2";
import { config } from "../config.js";
import { db } from "../db/supabase.js";
import { decrypt, encrypt } from "../db/crypto.js";
import { audit } from "../audit/log.js";

/**
 * Scopes are the whole permission surface. Gmail: read, compose drafts, send.
 * Calendar: read and write events. Drive: read only.
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

// Loopback redirect for a "Desktop app" OAuth client. The page will not load
// on the phone; the owner copies the address bar back into Telegram.
export const REDIRECT_URI = "http://localhost:8765/oauth/callback";

interface StoredToken {
  refresh_token: string;
  scopes: string[];
}

function newClient(): OAuth2Client {
  const c = config();
  return new OAuth2Client(c.GOOGLE_CLIENT_ID, c.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

export function authUrl(): string {
  return newClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

/** Accepts either the raw code or the full pasted redirect URL. */
export function extractCode(input: string): string | null {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("code");
  } catch {
    if (/^[\w\-./]{20,}$/.test(trimmed)) return trimmed;
    return null;
  }
}

export async function connectWithCode(code: string): Promise<string> {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and try /connect again.");
  }
  client.setCredentials(tokens);
  const me = await oauth2({ version: "v2", auth: client }).userinfo.get();
  const email = me.data.email ?? "unknown";
  const stored: StoredToken = { refresh_token: tokens.refresh_token, scopes: tokens.scope?.split(" ") ?? SCOPES };
  const { error } = await db().from("assistant_oauth_tokens").upsert({
    provider: "google",
    encrypted: encrypt(JSON.stringify(stored)),
    account_email: email,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not store token: ${error.message}`);
  await audit("action", "owner", { action: "google_connected", email });
  return email;
}

export async function connectedEmail(): Promise<string | null> {
  const { data } = await db().from("assistant_oauth_tokens").select("account_email").eq("provider", "google").maybeSingle();
  return data?.account_email ?? null;
}

async function loadStored(): Promise<StoredToken | null> {
  const { data, error } = await db().from("assistant_oauth_tokens").select("encrypted").eq("provider", "google").maybeSingle();
  if (error) throw new Error(`Could not load token: ${error.message}`);
  if (!data) return null;
  return JSON.parse(decrypt(data.encrypted)) as StoredToken;
}

/** An authorised client, or null when Google is not connected. */
export async function googleClient(): Promise<OAuth2Client | null> {
  const stored = await loadStored();
  if (!stored) return null;
  const client = newClient();
  client.setCredentials({ refresh_token: stored.refresh_token });
  return client;
}

export class NotConnectedError extends Error {
  constructor() {
    super("Google is not connected. Send /connect in Telegram to link your account.");
  }
}

export async function requireGoogle(): Promise<OAuth2Client> {
  const c = await googleClient();
  if (!c) throw new NotConnectedError();
  return c;
}

/**
 * Revoke means gone: the token is invalidated at Google, then the row is
 * deleted. Either step failing is reported, not hidden.
 */
export async function disconnect(): Promise<{ revokedAtGoogle: boolean; deletedLocally: boolean }> {
  const stored = await loadStored();
  let revokedAtGoogle = false;
  if (stored) {
    try {
      await newClient().revokeToken(stored.refresh_token);
      revokedAtGoogle = true;
    } catch (e) {
      await audit("error", "system", { where: "revokeToken", message: String(e) });
    }
  }
  const { error } = await db().from("assistant_oauth_tokens").delete().eq("provider", "google");
  const deletedLocally = !error;
  await audit("action", "owner", { action: "google_disconnected", revokedAtGoogle, deletedLocally });
  return { revokedAtGoogle, deletedLocally };
}
