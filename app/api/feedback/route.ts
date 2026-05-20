import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logActivity } from "@/lib/activity";
import { filterAccessibleCards, filterAccessibleFeedback, getAccessibleProjectIds } from "@/lib/access";
import { z } from "zod";

const fbSchema = z.object({
  card_id:        z.string().uuid(),
  checkpoint:     z.union([z.literal(10), z.literal(30), z.literal(50), z.literal(70), z.literal(90)]),
  lens:           z.string().min(1).max(40),
  note:           z.string().min(1).max(2000),
  next_action:    z.string().max(500).optional(),
  assigned_to_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const cardId = url.searchParams.get("card_id");

  const assignedToMe = url.searchParams.get("assigned_to_me") === "1";

  let q = sb.from("feedback_log").select("*").order("created_at", { ascending: false });
  if (cardId) q = q.eq("card_id", cardId);
  if (assignedToMe) q = q.eq("assigned_to_id", user.id).neq("status", "resolved");

  const [
    profileRes,
    departmentsRes,
    teamsRes,
    teamMembersRes,
    projectsRes,
    projectAccessRes,
    cardsRes,
    feedbackRes,
  ] = await Promise.all([
    sb.from("users").select("id, role, department_id").eq("id", user.id).single(),
    sb.from("departments").select("*"),
    sb.from("teams").select("*"),
    sb.from("team_members").select("*"),
    sb.from("projects").select("*"),
    sb.from("project_access").select("project_id, user_id"),
    sb.from("cards").select("*").is("deleted_at", null),
    q,
  ]);

  const data = feedbackRes.data;
  const error = feedbackRes.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!profileRes.data) return NextResponse.json({ error: "no profile" }, { status: 403 });
  const accessibleProjectIds = getAccessibleProjectIds({
    profile: profileRes.data as any,
    departments: departmentsRes.data ?? [],
    teams: teamsRes.data ?? [],
    teamMembers: teamMembersRes.data ?? [],
    projects: projectsRes.data ?? [],
    projectAccess: projectAccessRes.data ?? [],
  });
  const visibleCards = filterAccessibleCards({
    profile: profileRes.data as any,
    cards: cardsRes.data ?? [],
    accessibleProjectIds,
  });
  const visibleCardIds = new Set(visibleCards.map((c) => c.id));
  return NextResponse.json({ feedback: filterAccessibleFeedback(data ?? [], visibleCardIds, profileRes.data as any) });
}

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = fbSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: me } = await sb
    .from("users")
    .select("id, org_id, role, department_id, name, email")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

  const [
    cardRes,
    departmentsRes,
    teamsRes,
    teamMembersRes,
    projectsRes,
    projectAccessRes,
  ] = await Promise.all([
    sb.from("cards").select("*").eq("id", parsed.data.card_id).single(),
    sb.from("departments").select("*"),
    sb.from("teams").select("*"),
    sb.from("team_members").select("*"),
    sb.from("projects").select("*"),
    sb.from("project_access").select("project_id, user_id"),
  ]);
  if (!cardRes.data) return NextResponse.json({ error: "card not found" }, { status: 404 });
  const accessibleProjectIds = getAccessibleProjectIds({
    profile: me as any,
    departments: departmentsRes.data ?? [],
    teams: teamsRes.data ?? [],
    teamMembers: teamMembersRes.data ?? [],
    projects: projectsRes.data ?? [],
    projectAccess: projectAccessRes.data ?? [],
  });
  if (filterAccessibleCards({ profile: me as any, cards: [cardRes.data], accessibleProjectIds }).length === 0) {
    return NextResponse.json({ error: "card access denied" }, { status: 403 });
  }

  const { assigned_to_id, ...rest } = parsed.data;
  const { data, error } = await sb
    .from("feedback_log")
    .insert({
      ...rest,
      org_id: me.org_id,
      reviewer_id: user.id,
      reviewer_name: me.name || me.email,
      ...(assigned_to_id ? { assigned_to_id, status: "pending_response" } : { status: "open" }),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logActivity({ sb, org_id: me.org_id, card_id: parsed.data.card_id,
    user_id: user.id, user_name: me.name || me.email, event_type: "feedback_logged",
    payload: { checkpoint: parsed.data.checkpoint, lens: parsed.data.lens } });

  return NextResponse.json({ feedback: data });
}
