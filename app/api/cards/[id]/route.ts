import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
} from "@/lib/google/calendar";
import { STAGE_PROGRESS, type StageId } from "@/lib/methodology";
import { filterAccessibleCards, getAccessibleProjectIds } from "@/lib/access";
import { logActivity } from "@/lib/activity";
import { embedsSchema } from "@/lib/security";
import { z } from "zod";

const patchSchema = z.object({
  project_id: z.string().uuid().optional(),
  title: z.string().min(1).max(500).optional(),
  notes: z.string().optional(),
  stage: z.enum(["on_order","prep_table","front_burner","back_burner","pass_qa","served"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  priority: z.enum(["high","medium","low"]).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  time_estimate_mins: z.number().int().min(0).nullable().optional(),
  embeds: embedsSchema.optional(),
  // Visibility permissions
  is_hidden: z.boolean().optional(),
  visible_to: z.array(z.string().uuid()).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await sb.from("users").select("id, org_id, role, department_id, name, email").eq("id", user.id).single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Read current card so we know what changed for Calendar sync
  const { data: existing } = await sb.from("cards").select("*").eq("id", params.id).single();
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
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
  if (filterAccessibleCards({ profile: me as any, cards: [existing], accessibleProjectIds }).length === 0) {
    return NextResponse.json({ error: "card access denied" }, { status: 403 });
  }
  if (parsed.data.project_id && !accessibleProjectIds.has(parsed.data.project_id)) {
    return NextResponse.json({ error: "project access denied" }, { status: 403 });
  }

  // Auto-derive progress from stage — stage is the single source of truth for progress
  const update: any = { ...parsed.data };
  if (update.stage && update.stage in STAGE_PROGRESS) {
    update.progress = STAGE_PROGRESS[update.stage as StageId];
  }

  // If hiding, record the owner
  if (update.is_hidden === true) {
    update.hidden_by = user.id;
  } else if (update.is_hidden === false) {
    update.hidden_by = null;
    update.visible_to = [];
  }

  const { data: card, error } = await sb
    .from("cards")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();
  if (error || !card) return NextResponse.json({ error: error?.message }, { status: 500 });

  // ---- Activity logging (fire-and-forget) ----
  const userName = me.name || me.email;
  const base = { sb, org_id: me.org_id, card_id: params.id, user_id: user.id, user_name: userName };
  if (parsed.data.stage && parsed.data.stage !== existing.stage) {
    logActivity({ ...base, event_type: "stage_changed", payload: { from: existing.stage, to: parsed.data.stage } });
  }
  if (parsed.data.assignee_id !== undefined && parsed.data.assignee_id !== existing.assignee_id) {
    logActivity({ ...base, event_type: "assignee_changed", payload: { assignee_id: parsed.data.assignee_id } });
  }
  if (parsed.data.priority && parsed.data.priority !== existing.priority) {
    logActivity({ ...base, event_type: "priority_changed", payload: { from: existing.priority, to: parsed.data.priority } });
  }
  if (parsed.data.due_date !== undefined && parsed.data.due_date !== existing.due_date) {
    logActivity({ ...base, event_type: "due_date_changed", payload: { due_date: parsed.data.due_date } });
  }
  if (parsed.data.start_date !== undefined && parsed.data.start_date !== existing.start_date) {
    logActivity({ ...base, event_type: "start_date_changed", payload: { start_date: parsed.data.start_date } });
  }
  if (parsed.data.title && parsed.data.title !== existing.title) {
    logActivity({ ...base, event_type: "title_changed", payload: { from: existing.title, to: parsed.data.title } });
  }
  if (parsed.data.tags) {
    logActivity({ ...base, event_type: "tags_changed", payload: { tags: parsed.data.tags } });
  }
  if (parsed.data.time_estimate_mins !== undefined) {
    logActivity({ ...base, event_type: "estimate_changed", payload: { mins: parsed.data.time_estimate_mins } });
  }

  // ---- Calendar sync ----
  // Only act if due_date or assignee_id changed, or title changed and event exists
  const dueDateChanged = parsed.data.due_date !== undefined && parsed.data.due_date !== existing.due_date;
  const assigneeChanged = parsed.data.assignee_id !== undefined && parsed.data.assignee_id !== existing.assignee_id;
  const titleChanged = parsed.data.title !== undefined && parsed.data.title !== existing.title;

  if (dueDateChanged || assigneeChanged) {
    // Delete old event if it exists
    if (existing.calendar_event_id && existing.assignee_id) {
      deleteCalendarEvent(existing.assignee_id, existing.calendar_event_id)
        .catch(err => console.error("[card.patch] cal delete:", err));
    }
    // Create new event if we have date + assignee
    if (card.due_date && card.assignee_id) {
      createCalendarEvent(card.assignee_id, card, process.env.NEXT_PUBLIC_APP_URL!)
        .then(async (eventId) => {
          if (eventId) {
            await sb.from("cards").update({ calendar_event_id: eventId }).eq("id", card.id);
          }
        })
        .catch(err => console.error("[card.patch] cal create:", err));
    } else {
      // Clear the stale event ID
      await sb.from("cards").update({ calendar_event_id: null }).eq("id", card.id);
    }
  } else if (titleChanged && existing.calendar_event_id && card.assignee_id) {
    updateCalendarEvent(card.assignee_id, existing.calendar_event_id, card, process.env.NEXT_PUBLIC_APP_URL!)
      .catch(err => console.error("[card.patch] cal update:", err));
  }

  return NextResponse.json({ card });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await sb.from("users").select("id, org_id, role, department_id, name, email").eq("id", user.id).single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

  // Read the full card before soft-deleting
  const { data: existing } = await sb.from("cards").select("*").eq("id", params.id).single();
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
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
  if (filterAccessibleCards({ profile: me as any, cards: [existing], accessibleProjectIds }).length === 0) {
    return NextResponse.json({ error: "card access denied" }, { status: 403 });
  }

  // Delete calendar event if exists
  if (existing.calendar_event_id && existing.assignee_id) {
    deleteCalendarEvent(existing.assignee_id, existing.calendar_event_id)
      .catch(err => console.error("[card.delete] cal:", err));
  }

  // Soft-delete: set deleted_at + deleted_by instead of removing
  const { error } = await sb
    .from("cards")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Create delete_log entry with full snapshot
  const { error: logErr } = await sb.from("delete_log").insert({
    org_id: me.org_id,
    card_id: params.id,
    card_snapshot: existing,
    deleted_by: user.id,
    deleted_by_name: me.name || me.email,
  });
  if (logErr) console.error("[card.delete] log:", logErr.message);

  return NextResponse.json({ ok: true });
}
