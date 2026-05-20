import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logActivity } from "@/lib/activity";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1).max(500),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  notes: z.string().optional().default(""),
});

const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  completed: z.boolean().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  notes: z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await sb
    .from("subtasks")
    .select("*")
    .eq("card_id", params.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ subtasks: data });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await sb.from("users").select("org_id").eq("id", user.id).single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { data, error } = await sb
    .from("subtasks")
    .insert({ ...parsed.data, card_id: params.id, org_id: me.org_id })
    .select()
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message }, { status: 500 });

  logActivity({ sb, org_id: me.org_id, card_id: params.id, user_id: user.id,
    user_name: (me as any).name || (me as any).email,
    event_type: "subtask_added", payload: { title: parsed.data.title } });

  return NextResponse.json({ subtask: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const subtaskId = url.searchParams.get("subtask_id");
  if (!subtaskId) return NextResponse.json({ error: "subtask_id required" }, { status: 400 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const update = { ...parsed.data, updated_at: new Date().toISOString() };

  const { data: existing } = await sb.from("subtasks").select("*").eq("id", subtaskId).single();

  const { data, error } = await sb
    .from("subtasks")
    .update(update)
    .eq("id", subtaskId)
    .eq("card_id", params.id)
    .select()
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message }, { status: 500 });

  const { data: me2 } = await sb.from("users").select("org_id, name, email").eq("id", user.id).single();
  if (me2) {
    const base = { sb, org_id: me2.org_id, card_id: params.id, user_id: user.id, user_name: (me2 as any).name || (me2 as any).email };
    if (parsed.data.completed === true && existing && !existing.completed) {
      logActivity({ ...base, event_type: "subtask_completed", payload: { title: existing.title } });
    } else if (parsed.data.progress !== undefined && existing && parsed.data.progress !== existing.progress) {
      logActivity({ ...base, event_type: "subtask_progress", payload: { title: existing?.title, progress: parsed.data.progress } });
    }
  }

  return NextResponse.json({ subtask: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const subtaskId = url.searchParams.get("subtask_id");
  if (!subtaskId) return NextResponse.json({ error: "subtask_id required" }, { status: 400 });

  const { error } = await sb
    .from("subtasks")
    .delete()
    .eq("id", subtaskId)
    .eq("card_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
