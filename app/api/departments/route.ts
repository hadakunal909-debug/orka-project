import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireAdmin, badRequest, dbError } from "@/lib/api-helpers";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.sb
    .from("departments")
    .select("*")
    .order("name", { ascending: true });
  if (error) return dbError(error);
  return NextResponse.json({ departments: data ?? [] });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  head_user_id: z.string().uuid().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const { data, error } = await ctx.sb
    .from("departments")
    .insert({ ...parsed.data, org_id: ctx.orgId })
    .select()
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ department: data });
}
