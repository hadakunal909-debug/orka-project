import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, badRequest, dbError } from "@/lib/api-helpers";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  is_public: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data, error } = await ctx.sb
    .from("workspaces")
    .update(parsed.data)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ workspace: data });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const { error } = await ctx.sb.from("workspaces").delete().eq("id", params.id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
