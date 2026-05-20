import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, badRequest, dbError } from "@/lib/api-helpers";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.sb
    .from("team_members")
    .select("*, user:users(id, email, name, avatar_url)")
    .eq("team_id", params.id);
  if (error) return dbError(error);
  return NextResponse.json({ members: data ?? [] });
}

const addSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["lead", "member"]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = addSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  // RLS lets admins or team leads insert
  const { data, error } = await ctx.sb
    .from("team_members")
    .upsert(
      { team_id: params.id, user_id: parsed.data.user_id, role: parsed.data.role ?? "member" },
      { onConflict: "team_id,user_id" }
    )
    .select()
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ member: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const userId = new URL(req.url).searchParams.get("user_id");
  if (!userId) return badRequest("user_id query param required");

  const { error } = await ctx.sb
    .from("team_members")
    .delete()
    .eq("team_id", params.id)
    .eq("user_id", userId);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
