import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, badRequest, dbError, isAdminRole, isSuperAdminRole } from "@/lib/api-helpers";

const updateSchema = z.object({
  role: z.enum(["super_admin", "admin", "dept_head", "team_lead", "member"]).optional(),
  department_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120).optional(),
  job_title: z.string().max(120).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data: target } = await ctx.sb
    .from("users")
    .select("role")
    .eq("id", params.id)
    .single();

  if (
    (parsed.data.role === "super_admin" || target?.role === "super_admin") &&
    !isSuperAdminRole(ctx.role)
  ) {
    return NextResponse.json({ error: "super admin only" }, { status: 403 });
  }

  // Prevent an elevated user from demoting the last elevated admin.
  if (parsed.data.role && !isAdminRole(parsed.data.role) && params.id === ctx.userId) {
    const { count } = await ctx.sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .in("role", ["admin", "super_admin"]);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot demote the last elevated admin" },
        { status: 400 }
      );
    }
  }

  const { data, error } = await ctx.sb
    .from("users")
    .update(parsed.data)
    .eq("id", params.id)
    .select("id, email, name, role, department_id, job_title")
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ user: data });
}
