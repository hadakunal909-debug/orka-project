import { z } from "zod";

const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const EMBED_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_URL_LENGTH = 2048;

export function isValidShareToken(token: string) {
  return SHARE_TOKEN_RE.test(token);
}

export function normalizeHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;

  return parsed.toString();
}

export const embedSchema = z.object({
  id: z.string().trim().regex(EMBED_ID_RE, "Invalid embed id"),
  url: z.string().trim().min(1).max(MAX_URL_LENGTH).transform((url, ctx) => {
    const normalized = normalizeHttpUrl(url);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Embed URL must be a valid http(s) URL without credentials",
      });
      return z.NEVER;
    }
    return normalized;
  }),
  title: z.string().trim().max(160).optional().transform((title) => title || undefined),
  created_at: z.string().trim().max(64).optional(),
});

export const embedsSchema = z.array(embedSchema).max(10);
