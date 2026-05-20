import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireAdmin, badRequest, dbError } from "@/lib/api-helpers";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const [teamsRes, membersRes] = await Promise.all([
    ctx.sb.from("teams").select("*").order("name"),
    ctx.sb.from("team_members").select("*"),
  ]);
  if (teamsRes.error) return dbError(teamsRes.error);
  if (membersRes.error) return dbError(membersRes.error);
  return NextResponse.json({
    teams: teamsRes.data ?? [],
    members: membersRes.data ?? [],
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data: team, error } = await ctx.sb
    .from("teams")
    .insert({ ...parsed.data, org_id: ctx.orgId })
    .select()
    .single();
  if (error) return dbError(error);

  // If a lead was set, also add them as a team member with role 'lead'
  if (team.lead_id) {
    await ctx.sb.from("team_members").upsert(
      { team_id: team.id, user_id: team.lead_id, role: "lead" },
      { onConflict: "team_id,user_id" }
    );
  }

  return NextResponse.json({ team });
}
