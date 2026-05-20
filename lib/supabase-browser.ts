"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Singleton so we don't leak Supabase clients (and their WebSocket connections)
// on every component remount. Without this, DashboardClient's effects each
// spin up a fresh client and we end up with 5-6 realtime channels open.
let cached: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return cached;
}
