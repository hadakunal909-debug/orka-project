import { google } from "googleapis";
import { decryptToken } from "../encryption";
import { createAdminClient } from "../supabase-server";

/**
 * OAuth scopes requested at sign-in.
 * Keep these minimal — add more only when you need them.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
];

export function makeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`
  );
}

/**
 * Get an authenticated Google API client for a specific user, decrypting
 * their stored refresh token. Returns null if user has no token saved.
 */
export async function getGoogleClientForUser(userId: string) {
  const sb = createAdminClient();
  const { data: user } = await sb
    .from("users")
    .select("google_refresh_token")
    .eq("id", userId)
    .single();

  if (!user?.google_refresh_token) return null;

  const refreshToken = decryptToken(Buffer.from(user.google_refresh_token));
  const oauth = makeOAuthClient();
  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}
