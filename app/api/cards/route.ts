import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "@/lib/google/calendar";
import { filterAccessibleCards, getAccessibleProjectIds, isAdmin } from "@/lib/access";
import { z } from "zod";

const cardCreateSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  notes: z.string().optional().default(""),
  priority: z.enum(["high", "medium", "low"]).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

const cardUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().optional(),
  stage: z.enum(["on_order","prep_table","front_burner","back_burner","pass_qa","served"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  priority: z.enum(["high","medium","low"]).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

/**
 * GET /api/cards — list cards visible to user (RLS filters to org)
 * Query params: ?project_id=...&assignee_id=...&stage=...
 */
export async function GET(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  // Only fetch non-deleted cards
  let q = sb.from("cards").select("*").is("deleted_at", null).order("created_at", { ascending: false });

  const projectId = url.searchParams.get("project_id");
  const assigneeId = url.searchParams.get("assignee_id");
  const stage = url.searchParams.get("stage");
  if (projectId) q = q.eq("project_id", projectId);
  if (assigneeId) q = q.eq("assignee_id", assigneeId);
  if (stage) q = q.eq("stage", stage);

  const [
    profileRes,
    departmentsRes,
    teamsRes,
    teamMembersRes,
    projectsRes,
    projectAccessRes,
    cardsRes,
  ] = await Promise.all([
    sb.from("users").select("id, role, department_id").eq("id", user.id).single(),
    sb.from("departments").select("*"),
    sb.from("teams").select("*"),
    sb.from("team_members").select("*"),
    sb.from("projects").select("*"),
    sb.from("project_access").select("project_id, user_id"),
    q,
  ]);

  const data = cardsRes.data;
  const error = cardsRes.error;
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
  const filtered = filterAccessibleCards({
    profile: profileRes.data as any,
    cards: data ?? [],
    accessibleProjectIds,
  });

  return NextResponse.json({ cards: filtered });
}

/**
 * POST /api/cards — create card. If due_date + assignee given, create Calendar event.
 */
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = cardCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Get user's org_id
  const { data: me } = await sb.from("users").select("id, org_id, role, department_id").eq("id", user.id).single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

  if (!isAdmin(me as any)) {
    const [
      departmentsRes,
      teamsRes,
      teamMembersRes,
      projectsRes,
      projectAccessRes,
    ] = await Promise.all([
      sb.from("departments").select("*"),
      sb.from("teams").select("*"),
      sb.from("team_members").select("*"),
      sb.from("projects").select("*"),
      sb.from("project_access").select("project_id, user_id"),
    ]);
    const accessibleProjectIds = getAccessibleProjectIds({
      profile: me as any,
      departments: departmentsRes.data ?? [],
      teams: teamsRes.data ?? [],
      teamMembers: teamMembersRes.data ?? [],
      projects: projectsRes.data ?? [],
      projectAccess: projectAccessRes.data ?? [],
    });
    if (!accessibleProjectIds.has(parsed.data.project_id)) {
      return NextResponse.json({ error: "project access denied" }, { status: 403 });
    }
  }

  const { data: card, error } = await sb
    .from("cards")
    .insert({ ...parsed.data, org_id: me.org_id })
    .select()
    .single();

  if (error || !card) {
    return NextResponse.json({ error: error?.message || "create failed" }, { status: 500 });
  }

  // If we have a due date and assignee, fire-and-forget the calendar event
  if (card.due_date && card.assignee_id) {
    createCalendarEvent(card.assignee_id, card, process.env.NEXT_PUBLIC_APP_URL!)
      .then(async (eventId) => {
        if (eventId) {
          await sb.from("cards").update({ calendar_event_id: eventId }).eq("id", card.id);
        }
      })
      .catch(err => console.error("[cards.create] calendar:", err));
  }

  return NextResponse.json({ card });
}
