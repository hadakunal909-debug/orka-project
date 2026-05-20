import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, badRequest, dbError } from "@/lib/api-helpers";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.sb
    .from("workspaces")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return dbError(error);
  return NextResponse.json({ workspaces: data ?? [] });
}

const createSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data, error } = await ctx.sb
    .from("workspaces")
    .insert({ ...parsed.data, org_id: ctx.orgId })
    .select()
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ workspace: data });
}
