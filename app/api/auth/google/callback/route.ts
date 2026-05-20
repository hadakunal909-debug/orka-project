import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { makeOAuthClient, GOOGLE_SCOPES } from "@/lib/google/client";
import { encryptToken } from "@/lib/encryption";

/**
 * GET /api/auth/google/callback
 *
 * Handles the redirect from Google after the user authorizes the app.
 * 1. Exchanges the auth code for access + refresh tokens.
 * 2. Verifies the user belongs to the allowed workspace domain.
 * 3. Provisions org + user records if first time.
 * 4. Encrypts and stores the refresh token.
 * 5. Establishes a Supabase session and redirects to /dashboard.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    // Don't echo the raw Google error back into the URL — map to a safe key.
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=oauth_error`);
  }
  if (!code) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=no_code`);
  }

  // CSRF check: state from Google must match what we stored in the cookie.
  const expectedState = req.cookies.get("oauth_state")?.value;
  const receivedState = url.searchParams.get("state");
  if (!expectedState || !receivedState || expectedState !== receivedState) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=invalid_state`);
  }

  // 1. Exchange code for tokens
  const oauth = makeOAuthClient();
  const { tokens } = await oauth.getToken(code);
  if (!tokens.id_token) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=no_id_token`);
  }
  oauth.setCredentials(tokens);

  // 2. Verify the ID token to get verified user info
  const ticket = await oauth.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID!,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=email_unverified`);
  }

  // 3. Domain restriction — defense in depth even if OAuth is "Internal"
  const allowedDomain = process.env.ALLOWED_GOOGLE_DOMAIN;
  const userDomain = payload.email.split("@")[1];
  if (allowedDomain && userDomain !== allowedDomain) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=domain_not_allowed`);
  }

  // 4. Provision org and user via admin client (bypass RLS for this operation)
  const admin = createAdminClient();

  let { data: org } = await admin.from("organizations").select("*").eq("domain", userDomain).single();
  if (!org) {
    const { data: newOrg, error: orgErr } = await admin
      .from("organizations")
      .insert({ domain: userDomain, name: userDomain })
      .select()
      .single();
    if (orgErr || !newOrg) {
      console.error("Failed to create org:", orgErr);
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=provision_failed`);
    }
    org = newOrg;
  }

  // 5. Sign user into Supabase using ID token; this creates auth.users row
  const sb = createClient();
  const { data: authData, error: signInErr } = await sb.auth.signInWithIdToken({
    provider: "google",
    token: tokens.id_token,
    access_token: tokens.access_token ?? undefined,
  });

  if (signInErr || !authData.user) {
    console.error("Supabase sign-in failed:", signInErr);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=signin_failed`);
  }

  // 6. Upsert into our public users table — first-time users become super admin of their org
  const { data: existingUser } = await admin.from("users").select("id, role").eq("id", authData.user.id).single();

  const isFirstUserInOrg = !(await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id)).count;

  const userPatch: any = {
    id: authData.user.id,
    email: payload.email,
    name: payload.name ?? payload.email.split("@")[0],
    avatar_url: payload.picture ?? null,
    org_id: org.id,
    role: existingUser?.role ?? (isFirstUserInOrg ? "super_admin" : "member"),
  };

  // Only update refresh_token if we actually got one (Google sends it on first auth, or with prompt=consent)
  if (tokens.refresh_token) {
    userPatch.google_refresh_token = encryptToken(tokens.refresh_token);
  }
  if (tokens.expiry_date) {
    userPatch.google_token_expires_at = new Date(tokens.expiry_date).toISOString();
  }

  await admin.from("users").upsert(userPatch);

  // Clear the CSRF state cookie — it's been consumed.
  const dashboardRedirect = NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`);
  dashboardRedirect.cookies.set("oauth_state", "", { maxAge: 0, path: "/" });
  return dashboardRedirect;
}
