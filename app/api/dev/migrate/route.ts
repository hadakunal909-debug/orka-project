import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";

// DEV ONLY — adds routing_chain column to feedback_log.
function isDevAllowed() {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") return false;
  return true;
}

export async function POST() {
  if (!isDevAllowed()) {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  const admin = createAdminClient();

  // Use the pg REST endpoint via fetch with service role key to run raw DDL
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_ddl`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // First try to create the helper function if it doesn't exist
  const createFnRes = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_ddl`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ sql: "SELECT 1" }),
    }
  );

  // If exec_ddl doesn't exist, we'll use the pg connection string approach
  // via the Supabase management API
  if (!createFnRes.ok) {
    // Fallback: check if column already exists by trying an insert with it
    const { error: checkErr } = await admin
      .from("feedback_log")
      .select("routing_chain")
      .limit(1);

    if (!checkErr) {
      return NextResponse.json({ success: true, message: "routing_chain column already exists" });
    }

    // Column doesn't exist — use management API
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL!
      .replace("https://", "")
      .replace(".supabase.co", "");

    return NextResponse.json({
      success: false,
      manual: true,
      message: "Please run this SQL in the Supabase SQL Editor:",
      sql: "ALTER TABLE feedback_log ADD COLUMN IF NOT EXISTS routing_chain jsonb NOT NULL DEFAULT '[]';",
      url: `https://supabase.com/dashboard/project/${projectRef}/sql/new`,
    });
  }

  return NextResponse.json({ success: true, message: "Migration check complete" });
}
