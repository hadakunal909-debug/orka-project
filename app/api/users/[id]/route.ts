import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isAdminRole } from "@/lib/api-helpers";
import { z } from "zod";

const patchSchema = z.object({
  name:           z.string().min(1).max(120).optional(),
  job_title:      z.string().max(120).optional(),
  manager_id:     z.string().uuid().nullable().optional(),
  e2e_public_key: z.string().max(2048).nullable().optional(),
  last_seen_at:   z.string().datetime().optional(),
});

/**
 * GET /api/users/[id]
 * Returns public profile info for any user in the same org.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await sb
    .from("users")
    .select(`
      id, email, name, avatar_url, role, job_title,
      department_id, manager_id, last_seen_at, e2e_public_key,
      departments ( id, name, color )
    `)
    .eq("id", params.id)
    .single();

  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ user: data });
}

/**
 * PATCH /api/users/[id]
 * Users can update their own profile. Admins can update any user in their org.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await sb
    .from("users")
    .select("id, org_id, role")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

  const isAdmin = isAdminRole(me.role);
  if (params.id !== user.id && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await sb
    .from("users")
    .update(parsed.data)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}
