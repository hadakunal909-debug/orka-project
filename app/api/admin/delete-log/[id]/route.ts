import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isAdminRole } from "@/lib/api-helpers";

/**
 * POST /api/admin/delete-log/[id]/restore — restore a soft-deleted card
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await sb.from("users").select("org_id, role").eq("id", user.id).single();
  if (!me || !isAdminRole(me.role)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  // Get the delete log entry
  const { data: logEntry } = await sb
    .from("delete_log")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!logEntry) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (logEntry.restored_at) return NextResponse.json({ error: "already restored" }, { status: 400 });

  // Restore the card: clear deleted_at, deleted_by
  const { error: restoreErr } = await sb
    .from("cards")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", logEntry.card_id);

  if (restoreErr) {
    return NextResponse.json({ error: restoreErr.message }, { status: 500 });
  }

  // Mark the log entry as restored
  await sb.from("delete_log")
    .update({ restored_at: new Date().toISOString(), restored_by: user.id })
    .eq("id", params.id);

  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/admin/delete-log/[id] — add/update admin comment
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await sb.from("users").select("org_id, role").eq("id", user.id).single();
  if (!me || !isAdminRole(me.role)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const body = await req.json();
  const comment = typeof body.admin_comment === "string" ? body.admin_comment : "";

  const { error } = await sb
    .from("delete_log")
    .update({ admin_comment: comment })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
