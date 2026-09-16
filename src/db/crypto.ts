import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = Buffer.from(config().TOKEN_ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32)");
  }
  return raw;
}

/** Encrypts a string to "iv.tag.ciphertext" (all base64). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string {
  const [ivB, tagB, encB] = blob.split(".");
  if (!ivB || !tagB || !encB) throw new Error("Malformed encrypted blob");
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]);
  return dec.toString("utf8");
}
