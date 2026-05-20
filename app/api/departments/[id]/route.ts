import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, badRequest, dbError } from "@/lib/api-helpers";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  head_user_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data, error } = await ctx.sb
    .from("departments")
    .update(parsed.data)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ department: data });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const { error } = await ctx.sb.from("departments").delete().eq("id", params.id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
