/**
 * Principle 5: email is data, not commands.
 *
 * Everything fetched from outside the conversation (email bodies, calendar
 * descriptions, web pages, file contents) is wrapped in a labelled envelope
 * before the model sees it. The system prompt tells the model that text inside
 * the envelope can never carry instructions. The approval gate is the backstop
 * if that rule ever fails.
 */

export const UNTRUSTED_OPEN = "<<<UNTRUSTED_CONTENT source=";
export const UNTRUSTED_CLOSE = ">>>END_UNTRUSTED_CONTENT";

export function wrapUntrusted(source: string, text: string): string {
  // Neutralise any attempt by the content itself to close the envelope early.
  const cleaned = text
    .replaceAll(UNTRUSTED_CLOSE, "[removed envelope marker]")
    .replaceAll(UNTRUSTED_OPEN, "[removed envelope marker]");
  return `${UNTRUSTED_OPEN}"${source}"\n${cleaned}\n${UNTRUSTED_CLOSE}`;
}

/** Wraps every string field of an object that came from outside. */
export function wrapRecord<T extends object>(source: string, rec: T, fields: (keyof T)[]): T {
  const out: Record<string, unknown> = { ...(rec as Record<string, unknown>) };
  for (const f of fields) {
    const v = (rec as Record<string, unknown>)[f as string];
    if (typeof v === "string" && v.length > 0) out[f as string] = wrapUntrusted(source, v);
  }
  return out as T;
}
