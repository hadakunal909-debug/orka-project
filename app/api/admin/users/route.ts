import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, badRequest, dbError, isSuperAdminRole } from "@/lib/api-helpers";
import { createAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.sb
    .from("users")
    .select("id, email, name, avatar_url, role, department_id, job_title, created_at")
    .order("created_at", { ascending: true });
  if (error) return dbError(error);
  return NextResponse.json({ users: data ?? [] });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(72),
  role: z.enum(["super_admin", "admin", "dept_head", "team_lead", "member"]).default("member"),
  department_id: z.string().uuid().nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
  job_title: z.string().max(120).nullable().optional(),
});

/**
 * POST /api/admin/users — create a new user directly (no OAuth required)
 */
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.flatten());
  if (parsed.data.role === "super_admin" && !isSuperAdminRole(ctx.role)) {
    return NextResponse.json({ error: "super admin only" }, { status: 403 });
  }

  const admin = createAdminClient();

  // 1. Create auth user
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { name: parsed.data.name },
  });
  if (authErr || !created.user) {
    return NextResponse.json({ error: authErr?.message || "auth create failed" }, { status: 500 });
  }

  // 2. Upsert profile in public.users
  const { data: profile, error: profileErr } = await admin.from("users").upsert({
    id: created.user.id,
    email: parsed.data.email,
    name: parsed.data.name,
    org_id: ctx.orgId,
    role: parsed.data.role,
    department_id: parsed.data.department_id ?? null,
    job_title: parsed.data.job_title ?? null,
  }).select("id, email, name, avatar_url, role, department_id, job_title, created_at").single();

  if (profileErr || !profile) {
    // Clean up the auth user if profile insert failed
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileErr?.message || "profile create failed" }, { status: 500 });
  }

  // 3. Optional: add to team
  if (parsed.data.team_id) {
    const teamRole = parsed.data.role === "team_lead" ? "lead" : "member";
    const { error: tmErr } = await admin
      .from("team_members")
      .upsert({ team_id: parsed.data.team_id, user_id: profile.id, role: teamRole });
    if (tmErr) {
      // Non-fatal — user is created, team add failed
      console.warn("team_members insert failed:", tmErr.message);
    }
  }

  return NextResponse.json({ user: profile }, { status: 201 });
}
