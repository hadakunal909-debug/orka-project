import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { makeOAuthClient, GOOGLE_SCOPES } from "@/lib/google/client";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/**
 * GET /api/auth/google/signin
 * Builds the Google authorization URL and redirects the browser to it.
 *
 * Key flags:
 *  - access_type=offline → request a refresh token
 *  - prompt=consent → force consent screen so we ALWAYS get refresh_token
 *  - hd=domain → hint Google to pre-select the workspace domain
 *  - state → anti-CSRF token stored in an httpOnly cookie and verified on callback
 */
export async function GET(req: NextRequest) {
  // Rate-limit: 20 OAuth initiations per IP per minute to prevent abuse.
  const ip = clientIp(req);
  const { allowed } = checkRateLimit(`google-signin:${ip}`, 20, 60_000);
  if (!allowed) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?error=rate_limited`
    );
  }

  // Generate anti-CSRF state: stored in an httpOnly cookie and sent to Google.
  const state = randomBytes(16).toString("hex");

  const oauth = makeOAuthClient();
  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    hd: process.env.ALLOWED_GOOGLE_DOMAIN,
    include_granted_scopes: true,
    state,
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes — enough for the OAuth round-trip
    path: "/",
  });
  return res;
}
