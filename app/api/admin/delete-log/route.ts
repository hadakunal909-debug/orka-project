import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isAdminRole } from "@/lib/api-helpers";

/**
 * GET /api/admin/delete-log — list all deleted cards (admin only)
 */
export async function GET(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Check admin
  const { data: me } = await sb.from("users").select("org_id, role").eq("id", user.id).single();
  if (!me || !isAdminRole(me.role)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const { data, error } = await sb
    .from("delete_log")
    .select("*")
    .eq("org_id", me.org_id)
    .order("deleted_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data || [] });
}
