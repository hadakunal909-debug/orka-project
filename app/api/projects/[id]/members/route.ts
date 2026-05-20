import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, badRequest, dbError } from "@/lib/api-helpers";

const addSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["viewer", "editor", "owner"]).default("viewer"),
});

/**
 * GET /api/projects/[id]/members — list project members
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.sb
    .from("project_access")
    .select("project_id, user_id, role, added_at")
    .eq("project_id", params.id);
  if (error) return dbError(error);
  return NextResponse.json({ members: data ?? [] });
}

/**
 * POST /api/projects/[id]/members — add/update a member
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = addSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data, error } = await ctx.sb
    .from("project_access")
    .upsert(
      { project_id: params.id, user_id: parsed.data.user_id, role: parsed.data.role },
      { onConflict: "project_id,user_id" }
    )
    .select()
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ member: data }, { status: 201 });
}

/**
 * DELETE /api/projects/[id]/members?user_id=<uuid>
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return badRequest({ user_id: "required" });

  const { error } = await ctx.sb
    .from("project_access")
    .delete()
    .eq("project_id", params.id)
    .eq("user_id", userId);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
