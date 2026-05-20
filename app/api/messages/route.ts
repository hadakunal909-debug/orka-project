import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logActivity } from "@/lib/activity";
import { filterAccessibleCards, getAccessibleProjectIds } from "@/lib/access";
import { z } from "zod";

const createSchema = z
  .object({
    project_id: z.string().uuid().optional(),
    card_id: z.string().uuid().optional(),
    recipient_id: z.string().uuid().optional(),
    content: z.string().min(1).max(8000),
    is_encrypted: z.boolean().optional().default(false),
  })
  .refine((d) => d.project_id || d.card_id || d.recipient_id, {
    message: "Either project_id, card_id, or recipient_id is required",
  });

function extractMentions(
  content: string,
  users: { id: string; name: string | null; email: string }[]
): string[] {
  const handles = [...content.matchAll(/@([\w.-]+)/g)].map((m) =>
    m[1].toLowerCase()
  );
  if (handles.length === 0) return [];
  return users
    .filter((u) =>
      handles.includes((u.name || u.email.split("@")[0]).toLowerCase())
    )
    .map((u) => u.id);
}

/**
 * GET /api/messages
 * ?project_id=<uuid>    — project channel messages
 * ?card_id=<uuid>       — card-level comments
 * ?recipient_id=<uuid>  — DM thread between current user and that user
 */
export async function GET(req: NextRequest) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id");
  const cardId = url.searchParams.get("card_id");
  const recipientId = url.searchParams.get("recipient_id");
  const { data: me } = await sb
    .from("users")
    .select("id, org_id, role, department_id")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

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

  let q = sb
    .from("messages")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(300);

  if (projectId) {
    if (!accessibleProjectIds.has(projectId)) {
      return NextResponse.json({ error: "project access denied" }, { status: 403 });
    }
    q = q.eq("project_id", projectId).is("card_id", null).is("recipient_id", null);
  } else if (cardId) {
    const { data: card } = await sb.from("cards").select("*").eq("id", cardId).single();
    if (!card || filterAccessibleCards({ profile: me as any, cards: [card], accessibleProjectIds }).length === 0) {
      return NextResponse.json({ error: "card access denied" }, { status: 403 });
    }
    q = q.eq("card_id", cardId).is("project_id", null).is("recipient_id", null);
  } else if (recipientId) {
    // DM thread between me and the other person (either direction)
    q = q
      .is("project_id", null)
      .is("card_id", null)
      .not("recipient_id", "is", null)
      .in("author_id", [user.id, recipientId])
      .in("recipient_id", [user.id, recipientId]);
  } else {
    return NextResponse.json(
      { error: "project_id, card_id, or recipient_id required" },
      { status: 400 }
    );
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data });
}

/**
 * POST /api/messages — send a message (project chat, card comment, or DM)
 */
export async function POST(req: NextRequest) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: me } = await sb
    .from("users")
    .select("id, org_id, role, department_id, name, email")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

  const { data: orgUsers } = await sb
    .from("users")
    .select("id, name, email")
    .eq("org_id", me.org_id);

  const mentions = extractMentions(parsed.data.content, orgUsers ?? []);
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
  if (parsed.data.project_id && !accessibleProjectIds.has(parsed.data.project_id)) {
    return NextResponse.json({ error: "project access denied" }, { status: 403 });
  }
  if (parsed.data.card_id) {
    const { data: card } = await sb.from("cards").select("*").eq("id", parsed.data.card_id).single();
    if (!card || filterAccessibleCards({ profile: me as any, cards: [card], accessibleProjectIds }).length === 0) {
      return NextResponse.json({ error: "card access denied" }, { status: 403 });
    }
  }

  const { data: message, error } = await sb
    .from("messages")
    .insert({
      org_id: me.org_id,
      project_id: parsed.data.project_id ?? null,
      card_id: parsed.data.card_id ?? null,
      recipient_id: parsed.data.recipient_id ?? null,
      author_id: user.id,
      content: parsed.data.content,
      is_encrypted: parsed.data.is_encrypted ?? false,
      mentions,
    })
    .select()
    .single();

  if (error || !message) {
    return NextResponse.json(
      { error: error?.message || "create failed" },
      { status: 500 }
    );
  }

  // Log activity if this is a card comment
  if (parsed.data.card_id) {
    logActivity({ sb, org_id: me.org_id, card_id: parsed.data.card_id, user_id: user.id,
      user_name: me.name || me.email,
      event_type: "comment_added",
      payload: { preview: parsed.data.content.slice(0, 100) } });
  }

  return NextResponse.json({ message }, { status: 201 });
}
