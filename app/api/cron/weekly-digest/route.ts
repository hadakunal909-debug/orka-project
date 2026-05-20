import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { sendGmail, weeklyDigestEmail } from "@/lib/google/gmail";
import { needsFeedback, stageById } from "@/lib/methodology";

/**
 * GET /api/cron/weekly-digest
 * Runs Monday morning. Sends each user a summary of their assigned cards.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createAdminClient();
  const { data: users, error } = await sb.from("users").select("id, email, name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  const weekOf = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  let sent = 0;

  for (const u of users ?? []) {
    const { data: cards } = await sb
      .from("cards")
      .select("id, title, stage, progress, last_feedback, due_date")
      .eq("assignee_id", u.id);

    if (!cards || cards.length === 0) continue;

    const inProgress = cards.filter(c => ["prep_table", "front_burner", "pass_qa"].includes(c.stage)).length;
    const fbNeeded = cards.filter(c => needsFeedback(c as any)).length;
    const todayStr = today.toISOString().split("T")[0];
    const overdue = cards.filter(c => c.due_date && c.due_date < todayStr && c.stage !== "served").length;
    const served = cards.filter(c => c.stage === "served").length;

    const highlights = cards
      .filter(c => c.stage !== "served")
      .slice(0, 5)
      .map(c => ({
        title: c.title,
        stage: stageById(c.stage as any).name,
        progress: c.progress,
      }));

    const html = weeklyDigestEmail({
      recipientName: u.name || u.email.split("@")[0],
      weekOf,
      inProgress, needsFeedback: fbNeeded, overdue, served,
      highlights,
      appUrl: process.env.NEXT_PUBLIC_APP_URL!,
    });

    const ok = await sendGmail(
      u.id,
      u.email,
      u.email,
      `Your Stagework week — ${weekOf}`,
      html
    );
    if (ok) sent++;
  }

  return NextResponse.json({ ok: true, sent, total_users: users?.length ?? 0 });
}
