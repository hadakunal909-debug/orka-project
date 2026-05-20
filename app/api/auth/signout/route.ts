import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function POST() {
  const sb = createClient();
  await sb.auth.signOut();
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/`);
}

export async function GET() {
  return POST();
}
