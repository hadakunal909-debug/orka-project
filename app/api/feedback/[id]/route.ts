import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase-server";
import { isAdminRole } from "@/lib/api-helpers";
import { z } from "zod";

const assignSchema = z.object({
  action: z.literal("assign"),
  assigned_to_id: z.string().uuid(),
});

const respondSchema = z.object({
  action: z.literal("respond"),
  response: z.string().min(1).max(2000),
});

const routeSchema = z.object({
  action: z.literal("route"),
  assigned_to_id: z.string().uuid(),
  note: z.string().max(2000).optional(),
});

const resolveSchema = z.object({
  action: z.literal("resolve"),
});

const patchSchema = z.discriminatedUnion("action", [
  assignSchema,
  respondSchema,
  routeSchema,
  resolveSchema,
]);

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await sb
    .from("feedback_log")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ feedback: data });
}

/**
 * PATCH /api/feedback/[id]
 *
 * Actions:
 *   assign   – reviewer assigns to someone (opens a task)
 *   respond  – current assignee writes a response (closes their task)
 *   route    – current assignee (or reviewer) hands off to next person with an optional note
 *   resolve  – reviewer marks the whole thread resolved
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
    .select("id, org_id, name, email, role")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

  const { data: fb, error: fbErr } = await sb
    .from("feedback_log")
    .select("*")
    .eq("id", params.id)
    .single();
  if (fbErr || !fb) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const isReviewer = fb.reviewer_id === user.id;
  const isAssignee = fb.assigned_to_id === user.id;
  const isAdmin    = isAdminRole(me.role);

  let patch: Record<string, unknown> = {};

  if (parsed.data.action === "assign") {
    if (!isReviewer && !isAdmin) {
      return NextResponse.json({ error: "only the reviewer can assign" }, { status: 403 });
    }
    const chain = Array.isArray(fb.routing_chain) ? fb.routing_chain : [];
    patch = {
      assigned_to_id: parsed.data.assigned_to_id,
      status: "pending_response",
      routing_chain: [
        ...chain,
        {
          from_id: user.id,
          from_name: me.name || me.email,
          to_id: parsed.data.assigned_to_id,
          note: "",
          action: "routed",
          at: new Date().toISOString(),
        },
      ],
    };

  } else if (parsed.data.action === "respond") {
    if (!isAssignee && !isAdmin) {
      return NextResponse.json({ error: "only the assignee can respond" }, { status: 403 });
    }
    const chain = Array.isArray(fb.routing_chain) ? fb.routing_chain : [];
    patch = {
      response: parsed.data.response,
      responded_at: new Date().toISOString(),
      status: "responded",
      routing_chain: [
        ...chain,
        {
          from_id: user.id,
          from_name: me.name || me.email,
          to_id: null,
          note: parsed.data.response,
          action: "responded",
          at: new Date().toISOString(),
        },
      ],
    };

  } else if (parsed.data.action === "route") {
    // Current assignee or reviewer can route to the next person
    if (!isAssignee && !isReviewer && !isAdmin) {
      return NextResponse.json({ error: "only the current assignee or reviewer can route" }, { status: 403 });
    }
    const chain = Array.isArray(fb.routing_chain) ? fb.routing_chain : [];
    patch = {
      assigned_to_id: parsed.data.assigned_to_id,
      status: "pending_response",
      routing_chain: [
        ...chain,
        {
          from_id: user.id,
          from_name: me.name || me.email,
          to_id: parsed.data.assigned_to_id,
          note: parsed.data.note || "",
          action: "routed",
          at: new Date().toISOString(),
        },
      ],
    };

  } else if (parsed.data.action === "resolve") {
    if (!isReviewer && !isAdmin) {
      return NextResponse.json({ error: "only the reviewer can resolve" }, { status: 403 });
    }
    patch = { status: "resolved" };
  }

  // Use the admin client for the UPDATE: authorization has already been enforced above
  // by the isReviewer/isAssignee/isAdmin checks, and the row-level policies on
  // feedback_log don't permit the assignee to write (only team members + admins do),
  // which would block responses/routing even though the API contract allows them.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("feedback_log")
    .update(patch)
    .eq("id", params.id)
    .eq("org_id", me.org_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feedback: data });
}
