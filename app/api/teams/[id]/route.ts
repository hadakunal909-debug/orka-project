import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, badRequest, dbError } from "@/lib/api-helpers";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data, error } = await ctx.sb
    .from("teams")
    .update(parsed.data)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ team: data });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const { error } = await ctx.sb.from("teams").delete().eq("id", params.id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
