import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, badRequest, dbError } from "@/lib/api-helpers";
import { embedsSchema } from "@/lib/security";

const bodySchema = z.object({ embeds: embedsSchema });

/**
 * PATCH /api/departments/[id]/embeds — update embeds on a department.
 * Any authenticated org member can manage department embeds.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data, error } = await ctx.sb
    .from("departments")
    .update({ embeds: parsed.data.embeds })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ department: data });
}
