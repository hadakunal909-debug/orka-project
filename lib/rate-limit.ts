/**
 * In-memory rate limiter for auth endpoints.
 * Works per-process — good enough for dev and single-instance deploys.
 * For multi-instance production, swap the Map for Redis (e.g. Upstash).
 */

type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

// Periodically sweep expired entries so the Map doesn't grow forever.
// Only starts the interval when this module is first imported.
let cleanupScheduled = false;
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 60_000);
}

export function checkRateLimit(
  key: string,
  maxAttempts = 10,
  windowMs = 60_000
): { allowed: boolean; retryAfter?: number } {
  scheduleCleanup();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= maxAttempts) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { allowed: true };
}

export function clientIp(req: Request): string {
  return (
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown"
  );
}
