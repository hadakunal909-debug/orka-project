import { NextResponse } from "next/server";
import type { AuthedContext } from "@/lib/api-helpers";
import { filterAccessibleCards, getAccessibleProjectIds } from "@/lib/access";

export async function requireCardAccess(ctx: AuthedContext, cardId: string) {
  const { data: profile } = await ctx.sb
    .from("users")
    .select("id, role, department_id")
    .eq("id", ctx.userId)
    .single();
  if (!profile) return NextResponse.json({ error: "no profile" }, { status: 403 });

  const { data: card } = await ctx.sb.from("cards").select("*").eq("id", cardId).single();
  if (!card) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [departmentsRes, teamsRes, teamMembersRes, projectsRes, projectAccessRes] = await Promise.all([
    ctx.sb.from("departments").select("*"),
    ctx.sb.from("teams").select("*"),
    ctx.sb.from("team_members").select("*"),
    ctx.sb.from("projects").select("*"),
    ctx.sb.from("project_access").select("project_id, user_id"),
  ]);

  const accessibleProjectIds = getAccessibleProjectIds({
    profile: profile as any,
    departments: departmentsRes.data ?? [],
    teams: teamsRes.data ?? [],
    teamMembers: teamMembersRes.data ?? [],
    projects: projectsRes.data ?? [],
    projectAccess: projectAccessRes.data ?? [],
  });

  const [visibleCard] = filterAccessibleCards({
    profile: profile as any,
    cards: [card],
    accessibleProjectIds,
  });

  if (!visibleCard) {
    return NextResponse.json({ error: "card access denied" }, { status: 403 });
  }

  return visibleCard;
}
