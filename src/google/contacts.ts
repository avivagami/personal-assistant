/**
 * Read-only contacts lookup, so "email Dana" resolves to the right person
 * instead of guessing from the inbox. Fetched live, never stored.
 */
import { people as peopleApi } from "@googleapis/people";
import { requireGoogle } from "./auth.js";

export interface Contact {
  name: string;
  emails: string[];
  phones: string[];
  org?: string;
}

async function client() {
  return peopleApi({ version: "v1", auth: await requireGoogle() });
}

function toContact(p: {
  names?: { displayName?: string | null }[] | null;
  emailAddresses?: { value?: string | null }[] | null;
  phoneNumbers?: { value?: string | null }[] | null;
  organizations?: { name?: string | null; title?: string | null }[] | null;
}): Contact | null {
  const name = p.names?.[0]?.displayName ?? "";
  const emails = (p.emailAddresses ?? []).map((e) => e.value ?? "").filter(Boolean);
  const phones = (p.phoneNumbers ?? []).map((e) => e.value ?? "").filter(Boolean);
  if (!name && emails.length === 0) return null;
  const o = p.organizations?.[0];
  const org = [o?.title, o?.name].filter(Boolean).join(" at ") || undefined;
  return { name, emails, phones, ...(org ? { org } : {}) };
}

const FIELDS = "names,emailAddresses,phoneNumbers,organizations";

/** Searches the owner's own contacts by name, email or phone. */
export async function searchContacts(query: string, max = 8): Promise<Contact[]> {
  const c = await client();
  // The People API needs a warm-up call before search returns results.
  await c.people.searchContacts({ query: "", readMask: FIELDS, pageSize: 1 }).catch(() => {});
  const res = await c.people.searchContacts({ query, readMask: FIELDS, pageSize: Math.min(max, 30) });
  const out: Contact[] = [];
  for (const r of res.data.results ?? []) {
    const person = r.person ? toContact(r.person) : null;
    if (person) out.push(person);
  }
  // "Other contacts" are people emailed but never saved; often where a colleague lives.
  if (out.length < max) {
    const other = await c.otherContacts
      .search({ query, readMask: "names,emailAddresses,phoneNumbers", pageSize: Math.min(max - out.length, 30) })
      .catch(() => null);
    for (const r of other?.data.results ?? []) {
      const person = r.person ? toContact(r.person) : null;
      if (person && !out.some((x) => x.emails[0] && x.emails[0] === person.emails[0])) out.push(person);
    }
  }
  return out;
}
