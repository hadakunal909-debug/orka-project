import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/auth/signin
 * Body: { email, password }
 * Signs the user in with Supabase email/password auth and sets the session cookie.
 */
export async function POST(req: NextRequest) {
  let email: string | null = null;
  let password: string | null = null;

  // Support both JSON and form-encoded submissions
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    email = typeof body.email === "string" ? body.email.trim() : null;
    password = typeof body.password === "string" ? body.password : null;
  } else {
    const form = await req.formData();
    email = (form.get("email") as string | null)?.trim() ?? null;
    password = (form.get("password") as string | null) ?? null;
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  // Rate-limit by IP: 10 attempts per minute.
  const ip = clientIp(req);
  const { allowed, retryAfter } = checkRateLimit(`signin:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please try again later." },
      { status: 429, headers: retryAfter ? { "Retry-After": String(retryAfter) } : {} }
    );
  }

  const sb = createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    const isJson = contentType.includes("application/json");
    // Always return a generic message — never leak whether the email exists.
    const genericMsg = "Invalid email or password.";
    if (isJson) {
      return NextResponse.json({ error: genericMsg }, { status: 401 });
    }
    const url = new URL("/", process.env.NEXT_PUBLIC_APP_URL || req.url);
    url.searchParams.set("error", "signin_failed");
    return NextResponse.redirect(url, 303);
  }

  if (contentType.includes("application/json")) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.redirect(
    new URL("/dashboard", process.env.NEXT_PUBLIC_APP_URL || req.url),
    303
  );
}
