import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { isValidShareToken } from "@/lib/security";

/**
 * GET /api/public/workspace/[token]
 *  - Public, view-only data for an external client.
 *  - Returns the workspace, its project, and that project's cards.
 *  - We use the service-role client because RLS blocks anon access; the
 *    share_token is the trust boundary, so we ONLY return data scoped to
 *    that exact workspace.
 */
export async function GET(_: NextRequest, { params }: { params: { token: string } }) {
  if (!isValidShareToken(params.token)) {
    return NextResponse.json({ error: "invalid token" }, { status: 404 });
  }

  const sb = createAdminClient();

  const { data: workspace, error: wsErr } = await sb
    .from("workspaces")
    .select("id, name, description, project_id, is_public, share_token")
    .eq("share_token", params.token)
    .eq("is_public", true)
    .maybeSingle();

  if (wsErr) return NextResponse.json({ error: wsErr.message }, { status: 500 });
  if (!workspace) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [projectRes, cardsRes] = await Promise.all([
    sb.from("projects")
      .select("id, name, description, status")
      .eq("id", workspace.project_id)
      .single(),
    sb.from("cards")
      .select("id, title, stage, progress, priority, due_date, last_feedback, created_at")
      .eq("project_id", workspace.project_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  // Bookkeeping: bump last_seen on any guest row associated with this workspace.
  // (Phase 2 can be smarter — per-email guest tokens.)
  await sb
    .from("workspace_guests")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("workspace_id", workspace.id);

  return NextResponse.json({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
    },
    project: projectRes.data ?? null,
    cards: cardsRes.data ?? [],
  });
}
