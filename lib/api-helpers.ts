import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthedContext = {
  sb: SupabaseClient;
  userId: string;
  orgId: string;
  role: "super_admin" | "admin" | "dept_head" | "team_lead" | "member";
};

export function isAdminRole(role: string | null | undefined) {
  return role === "super_admin" || role === "admin";
}

export function isSuperAdminRole(role: string | null | undefined) {
  return role === "super_admin";
}

/**
 * Resolves the current user + org + role in one call. Returns a NextResponse
 * (401/403) on failure; otherwise returns AuthedContext.
 */
export async function requireUser(): Promise<AuthedContext | NextResponse> {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile, error } = await sb
    .from("users")
    .select("org_id, role")
    .eq("id", user.id)
    .single();
  if (error || !profile) {
    return NextResponse.json({ error: "no profile" }, { status: 403 });
  }

  return { sb, userId: user.id, orgId: profile.org_id, role: profile.role };
}

export async function requireAdmin(): Promise<AuthedContext | NextResponse> {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  if (!isAdminRole(ctx.role)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  return ctx;
}

export function badRequest(message: string | object) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function dbError(error: { message: string }) {
  return NextResponse.json({ error: error.message }, { status: 500 });
}
