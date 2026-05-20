import { SupabaseClient } from "@supabase/supabase-js";

export type ActivityEventType =
  | "card_created"
  | "stage_changed"
  | "assignee_changed"
  | "priority_changed"
  | "due_date_changed"
  | "start_date_changed"
  | "title_changed"
  | "tags_changed"
  | "estimate_changed"
  | "subtask_added"
  | "subtask_completed"
  | "subtask_progress"
  | "subtask_deleted"
  | "comment_added"
  | "feedback_logged"
  | "feedback_responded"
  | "feedback_routed"
  | "feedback_resolved";

export async function logActivity({
  sb,
  org_id,
  card_id,
  user_id,
  user_name,
  event_type,
  payload = {},
}: {
  sb: SupabaseClient;
  org_id: string;
  card_id: string;
  user_id: string;
  user_name: string;
  event_type: ActivityEventType;
  payload?: Record<string, unknown>;
}) {
  try {
    await sb.from("card_activity").insert({
      org_id,
      card_id,
      user_id,
      user_name,
      event_type,
      payload,
    });
  } catch {
    // Non-fatal — never breaks the main action
  }
}
