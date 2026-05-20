import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";

/**
 * POST /api/auth/dev-signin
 *
 * DEV-ONLY: skips Google OAuth and signs the user in as a fixed local super admin.
 * Disabled in production. Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
const DEV_DEFAULT_EMAIL = "dev@local.test";
const DEV_PASSWORD = "devpassword123";
const DEV_DOMAIN = "local.test";
const DEV_NAME = "Dev Admin";

function bail(message: string) {
  // Log the real reason server-side; never put internal details in the URL.
  console.error("[dev-signin]", message);
  const url = new URL("/", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  url.searchParams.set("error", "dev_signin_failed");
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled in production" }, { status: 404 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return bail("SUPABASE_SERVICE_ROLE_KEY is missing from .env.local — paste it and restart the dev server.");
  }

  const formData = await req.formData();
  const requestedEmail = (formData.get("email") as string | null)?.trim() || null;

  const admin = createAdminClient();

  // If a specific existing user was requested, sign in as them directly
  if (requestedEmail && requestedEmail !== DEV_DEFAULT_EMAIL) {
    const { data: profile } = await admin
      .from("users")
      .select("id, email, name, org_id")
      .eq("email", requestedEmail)
      .maybeSingle();

    if (!profile) return bail(`No user found with email: ${requestedEmail}`);

    // auth.users.id == public.users.id in Supabase — update directly by ID.
    const { error: updateErr } = await admin.auth.admin.updateUserById(profile.id, {
      password: DEV_PASSWORD,
      email_confirm: true,
    });
    if (updateErr) return bail(`updateUser: ${updateErr.message}`);

    const sb = createClient();
    const { error: signInErr } = await sb.auth.signInWithPassword({
      email: requestedEmail,
      password: DEV_PASSWORD,
    });
    if (signInErr) return bail(`signIn as ${requestedEmail}: ${signInErr.message}`);

    return NextResponse.redirect(
      new URL("/dashboard", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
      303
    );
  }

  // Default: sign in as dev@local.test super admin
  let authUserId: string | null = null;
  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) return bail(`auth list failed: ${listErr.message}`);
  const existing = list.users.find(u => u.email === DEV_DEFAULT_EMAIL);
  if (existing) {
    authUserId = existing.id;
    await admin.auth.admin.updateUserById(existing.id, { password: DEV_PASSWORD });
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: DEV_DEFAULT_EMAIL,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { name: DEV_NAME },
    });
    if (error || !created.user) return bail(`createUser: ${error?.message || "unknown"}`);
    authUserId = created.user.id;
  }

  let { data: org } = await admin.from("organizations").select("*").eq("domain", DEV_DOMAIN).maybeSingle();
  if (!org) {
    const { data: newOrg, error } = await admin
      .from("organizations")
      .insert({ domain: DEV_DOMAIN, name: "Local Dev" })
      .select()
      .single();
    if (error || !newOrg) {
      return bail(`org create: ${error?.message || "did you run supabase/schema.sql?"}`);
    }
    org = newOrg;
  }

  const devProfile = {
    id: authUserId,
    email: DEV_DEFAULT_EMAIL,
    name: DEV_NAME,
    org_id: org.id,
    role: "super_admin",
  };
  let { error: profileErr } = await admin.from("users").upsert(devProfile);
  if (profileErr?.message.includes("invalid input value for enum user_role")) {
    const retry = await admin.from("users").upsert({ ...devProfile, role: "admin" });
    profileErr = retry.error;
  }
  if (profileErr) return bail(`profile upsert: ${profileErr.message}`);

  const sb = createClient();
  const { error: signInErr } = await sb.auth.signInWithPassword({
    email: DEV_DEFAULT_EMAIL,
    password: DEV_PASSWORD,
  });
  if (signInErr) return bail(`signIn: ${signInErr.message}`);

  return NextResponse.redirect(
    new URL("/dashboard", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
    303
  );
}
