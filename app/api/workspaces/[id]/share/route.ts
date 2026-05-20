import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireUser, dbError } from "@/lib/api-helpers";

/**
 * POST /api/workspaces/[id]/share
 *  - Generates (or rotates) the share_token and sets is_public=true.
 * DELETE /api/workspaces/[id]/share
 *  - Revokes the share token (sets it null and is_public=false).
 */
export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const token = randomBytes(24).toString("base64url");

  const { data, error } = await ctx.sb
    .from("workspaces")
    .update({ share_token: token, is_public: true })
    .eq("id", params.id)
    .select("id, share_token, is_public")
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ workspace: data });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const { error } = await ctx.sb
    .from("workspaces")
    .update({ share_token: null, is_public: false })
    .eq("id", params.id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
