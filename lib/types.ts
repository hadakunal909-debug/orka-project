import type { StageId } from "./methodology";

export type UserRole = "super_admin" | "admin" | "dept_head" | "team_lead" | "member";
export type TeamMemberRole = "lead" | "member";
export type WorkspaceMemberRole = "owner" | "editor" | "viewer";
export type ProjectStatus = "active" | "paused" | "archived";
export type FeedbackStatus = "open" | "pending_response" | "responded" | "resolved";

export type Org = {
  id: string;
  domain: string;
  name: string;
};

export type User = {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  org_id: string;
  role: UserRole;
  department_id: string | null;
  job_title: string | null;
  manager_id: string | null;
  last_seen_at: string | null;
  e2e_public_key: string | null;
  created_at?: string;
};

export type Department = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  color: string;
  head_user_id: string | null;
  created_at: string;
};

export type Team = {
  id: string;
  org_id: string;
  department_id: string | null;
  name: string;
  description: string | null;
  lead_id: string | null;
  created_at: string;
};

export type TeamMember = {
  team_id: string;
  user_id: string;
  role: TeamMemberRole;
  added_at: string;
};

export type ProjectVisibility = "private" | "team" | "org";

export type Project = {
  id: string;
  org_id: string;
  team_id: string | null;
  department_id: string | null;
  name: string;
  description: string | null;
  lead_id: string | null;
  drive_folder_id: string | null;
  sheet_id: string | null;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  created_at: string;
};

export type Workspace = {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  share_token: string | null;
  created_at: string;
};

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceMemberRole;
  added_at: string;
};

export type WorkspaceGuest = {
  id: string;
  workspace_id: string;
  email: string | null;
  name: string | null;
  invited_by: string | null;
  last_seen_at: string | null;
  created_at: string;
};

export type Card = {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  notes: string;
  stage: StageId;
  progress: number;
  priority: "high" | "medium" | "low";
  assignee_id: string | null;
  due_date: string | null;
  start_date: string | null;
  tags: string[];
  time_estimate_mins: number | null;
  last_feedback: number | null;
  calendar_event_id: string | null;
  doc_id: string | null;
  drive_folder_id: string | null;
  last_nudge_sent_at: string | null;
  // Visibility permissions
  is_hidden: boolean;
  hidden_by: string | null;
  visible_to: string[];
  // Soft-delete
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DeleteLogEntry = {
  id: string;
  org_id: string;
  card_id: string;
  card_snapshot: Card;
  deleted_by: string;
  deleted_by_name: string | null;
  deleted_at: string;
  restored_at: string | null;
  restored_by: string | null;
  admin_comment: string;
  created_at: string;
};

export type Subtask = {
  id: string;
  card_id: string;
  org_id: string;
  title: string;
  progress: number;
  completed: boolean;
  assignee_id: string | null;
  due_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type RoutingChainEntry = {
  from_id: string;
  from_name: string;
  to_id: string | null;
  note: string;
  action: "routed" | "responded";
  at: string;
};

export type FeedbackEntry = {
  id: string;
  org_id: string;
  card_id: string;
  reviewer_id: string | null;
  reviewer_name: string;
  checkpoint: 10 | 30 | 50 | 70 | 90;
  lens: string;
  note: string;
  next_action: string | null;
  // Routing fields
  assigned_to_id: string | null;
  response: string | null;
  responded_at: string | null;
  status: FeedbackStatus;
  routing_chain: RoutingChainEntry[];
  created_at: string;
};

export type Message = {
  id: string;
  org_id: string;
  project_id: string | null;
  card_id: string | null;
  recipient_id: string | null;
  author_id: string | null;
  content: string;       // plaintext for channels; base64 AES-GCM ciphertext for DMs
  is_encrypted: boolean;
  mentions: string[];
  created_at: string;
};

export type NotificationPrefs = {
  user_id: string;
  email_enabled: boolean;
  discord_enabled: boolean;
  discord_user_id: string | null;
  notify_assigned: boolean;
  notify_due_soon: boolean;
  notify_overdue: boolean;
  notify_feedback_received: boolean;
  notify_mention: boolean;
  digest_day: number;
  digest_hour: number;
  updated_at: string;
};
