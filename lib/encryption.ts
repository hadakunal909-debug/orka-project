import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM encryption for storing Google refresh tokens at rest.
 * Key must be a 32-byte base64 string. Generate with: openssl rand -base64 32
 *
 * Output format: [12-byte IV] + [16-byte auth tag] + [ciphertext]
 */
const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  // Accept TOKEN_ENCRYPTION_KEY (canonical) or ENCRYPTION_KEY (legacy fallback).
  const key = process.env.TOKEN_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY env var is required");
  // Auto-detect encoding: 64 hex chars = 32 bytes; otherwise treat as base64.
  const buf = /^[0-9a-fA-F]{64}$/.test(key)
    ? Buffer.from(key, "hex")
    : Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex)");
  }
  return buf;
}

export function encryptToken(plain: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptToken(buf: Buffer): string {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
