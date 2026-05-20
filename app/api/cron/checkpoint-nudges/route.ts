import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { sendGmail, checkpointNudgeEmail } from "@/lib/google/gmail";
import { needsFeedback, nextCheckpoint, CHECKPOINTS } from "@/lib/methodology";

/**
 * GET /api/cron/checkpoint-nudges
 *
 * Runs daily. Finds cards where:
 *  - Stage is not 'served'
 *  - Progress has crossed a checkpoint without feedback being logged
 *  - We haven't sent a nudge for this in the last 3 days
 *
 * Sends a Gmail nudge from the assignee's own account to themselves.
 * (You could change this to send from a shared service account instead.)
 *
 * Vercel auth: requires CRON_SECRET in Authorization header (Vercel sets this for scheduled jobs).
 */
export async function GET(req: NextRequest) {
  // Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createAdminClient();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000).toISOString();

  // Find candidate cards
  const { data: cards, error } = await sb
    .from("cards")
    .select("id, title, stage, progress, last_feedback, assignee_id, last_nudge_sent_at, org_id")
    .neq("stage", "served")
    .not("assignee_id", "is", null);

  if (error) {
    console.error("[cron] fetch cards failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;

  for (const card of cards ?? []) {
    if (!needsFeedback(card)) { skipped++; continue; }
    if (card.last_nudge_sent_at && card.last_nudge_sent_at > threeDaysAgo) {
      skipped++; continue;
    }

    // Look up assignee email + name
    const { data: assignee } = await sb
      .from("users")
      .select("email, name")
      .eq("id", card.assignee_id!)
      .single();
    if (!assignee?.email) { skipped++; continue; }

    const next = nextCheckpoint(card.progress, card.last_feedback);
    if (!next) { skipped++; continue; }

    const html = checkpointNudgeEmail({
      recipientName: assignee.name || assignee.email.split("@")[0],
      cardTitle: card.title,
      checkpoint: next.pct,
      checkpointLabel: next.label,
      cardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?card=${card.id}`,
    });

    const ok = await sendGmail(
      card.assignee_id!,
      assignee.email,
      assignee.email,
      `[Stagework] ${next.pct}% checkpoint — ${card.title}`,
      html
    );

    if (ok) {
      await sb.from("cards").update({ last_nudge_sent_at: new Date().toISOString() }).eq("id", card.id);
      sent++;
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, scanned: cards?.length ?? 0 });
}
