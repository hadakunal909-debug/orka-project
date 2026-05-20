import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? new Date(0).toISOString();

  // Messages sent TO me (DMs) or in my org's channels, after `since`
  const { data: me } = await sb.from("users").select("org_id").eq("id", user.id).single();
  if (!me) return NextResponse.json({ messages: [] });

  const { data, error } = await sb
    .from("messages")
    .select("id, author_id, recipient_id, card_id, project_id, content, created_at")
    .eq("org_id", me.org_id)
    .gt("created_at", since)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}
