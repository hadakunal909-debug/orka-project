import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, badRequest, dbError } from "@/lib/api-helpers";
import { embedsSchema as embedListSchema } from "@/lib/security";

const embedsSchema = z.object({
  embeds: embedListSchema,
});

/**
 * PATCH /api/teams/[id]/embeds — update embeds on a team.
 * Any authenticated org member can manage team embeds (they are
 * shared reference links, not access-controlled content).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = embedsSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data, error } = await ctx.sb
    .from("teams")
    .update({ embeds: parsed.data.embeds })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ team: data });
}
