-- ============================================================
-- Stagework — Database Schema (Admin PM model)
-- Run this in Supabase SQL Editor (or via supabase migration up).
-- This is a CLEAN-RESET schema — it drops legacy tables (programs)
-- and rebuilds projects under departments/teams/workspaces.
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ============================================================
-- DROP LEGACY (safe since dev data is throwaway)
-- ============================================================
drop table if exists feedback_log cascade;
drop table if exists cards cascade;
drop table if exists projects cascade;
drop table if exists programs cascade;
drop table if exists notification_prefs cascade;
drop table if exists workspace_guests cascade;
drop table if exists workspace_members cascade;
drop table if exists workspaces cascade;
drop table if exists team_members cascade;
drop table if exists teams cascade;
drop table if exists departments cascade;

drop type if exists stage cascade;
drop type if exists priority cascade;
drop type if exists user_role cascade;
drop type if exists workspace_member_role cascade;
drop type if exists team_member_role cascade;

-- ============================================================
-- ENUMS
-- ============================================================
create type stage as enum (
  'on_order','prep_table','front_burner','back_burner','pass_qa','served'
);
create type priority as enum ('high','medium','low');
create type user_role as enum ('super_admin','admin','dept_head','team_lead','member');
create type team_member_role as enum ('lead','member');
create type workspace_member_role as enum ('owner','editor','viewer');

-- ============================================================
-- ORG / USERS
-- ============================================================

-- (organizations table is created in initial setup; recreate if missing)
create table if not exists organizations (
  id uuid primary key default uuid_generate_v4(),
  domain text unique not null,
  name text not null,
  created_at timestamptz default now()
);

-- Users — drop and recreate cleanly to extend role enum and add dept_id
drop table if exists users cascade;
create table users (
  id uuid primary key references auth.users on delete cascade,
  email text unique not null,
  name text,
  avatar_url text,
  org_id uuid references organizations(id) on delete cascade not null,
  role user_role not null default 'member',
  department_id uuid,  -- FK added below after departments table exists
  google_refresh_token bytea,
  google_token_expires_at timestamptz,
  created_at timestamptz default now()
);
create index idx_users_org on users(org_id);
create index idx_users_dept on users(department_id);

-- ============================================================
-- DEPARTMENTS
-- HR, IT, Marketing, etc. Top-level org structure.
-- ============================================================
create table departments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade not null,
  name text not null,
  description text,
  color text not null default '#2563EB',
  head_user_id uuid references users(id) on delete set null,
  created_at timestamptz default now(),
  unique (org_id, name)
);
create index idx_departments_org on departments(org_id);

alter table users
  add constraint users_department_id_fkey
  foreign key (department_id) references departments(id) on delete set null;

-- ============================================================
-- TEAMS
-- Small project teams. May span departments (department_id nullable).
-- ============================================================
create table teams (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade not null,
  department_id uuid references departments(id) on delete set null,
  name text not null,
  description text,
  lead_id uuid references users(id) on delete set null,
  created_at timestamptz default now(),
  unique (org_id, name)
);
create index idx_teams_dept on teams(department_id);
create index idx_teams_org on teams(org_id);

create table team_members (
  team_id uuid references teams(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  role team_member_role not null default 'member',
  added_at timestamptz default now(),
  primary key (team_id, user_id)
);
create index idx_team_members_user on team_members(user_id);

-- ============================================================
-- PROJECTS
-- The unit of work. Belongs to a team (and optionally a department).
-- ============================================================
create table projects (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade not null,
  team_id uuid references teams(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  name text not null,
  description text,
  lead_id uuid references users(id) on delete set null,
  -- Google integration links (filled by integration code)
  drive_folder_id text,
  sheet_id text,
  status text not null default 'active',  -- 'active' | 'paused' | 'archived'
  created_at timestamptz default now()
);
create index idx_projects_team on projects(team_id);
create index idx_projects_dept on projects(department_id);
create index idx_projects_org on projects(org_id);

-- ============================================================
-- WORKSPACES
-- Client-facing view of a project. Supports view-only share token (no login).
-- ============================================================
create table workspaces (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  description text,
  is_public boolean not null default false,
  -- 32+ chars unguessable; generated with encode(gen_random_bytes(24),'base64')
  share_token text unique,
  created_at timestamptz default now()
);
create index idx_workspaces_project on workspaces(project_id);
create index idx_workspaces_token on workspaces(share_token) where share_token is not null;
create index idx_workspaces_org on workspaces(org_id);

create table workspace_members (
  workspace_id uuid references workspaces(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  role workspace_member_role not null default 'viewer',
  added_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- Tracking of external clients we've shared the link with (informational;
-- access is via share_token, not via this row).
create table workspace_guests (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  email text,
  name text,
  invited_by uuid references users(id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz default now()
);
create index idx_workspace_guests_ws on workspace_guests(workspace_id);

-- ============================================================
-- CARDS — tasks within a project (unchanged shape, stages preserved)
-- ============================================================
create table cards (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade not null,
  title text not null,
  notes text default '',
  stage stage not null default 'on_order',
  progress int not null default 0 check (progress between 0 and 100),
  priority priority not null default 'medium',
  assignee_id uuid references users(id) on delete set null,
  due_date date,
  last_feedback int check (last_feedback in (10,30,50,70,90)),
  calendar_event_id text,
  doc_id text,
  drive_folder_id text,
  last_nudge_sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_cards_project on cards(project_id);
create index idx_cards_assignee on cards(assignee_id);
create index idx_cards_org on cards(org_id);
create index idx_cards_stage on cards(stage);

-- ============================================================
-- FEEDBACK LOG (unchanged)
-- ============================================================
create table feedback_log (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade not null,
  card_id uuid references cards(id) on delete cascade not null,
  reviewer_id uuid references users(id) on delete set null,
  reviewer_name text not null,
  checkpoint int not null check (checkpoint in (10,30,50,70,90)),
  lens text not null,
  note text not null,
  next_action text,
  created_at timestamptz default now()
);
create index idx_feedback_card on feedback_log(card_id);
create index idx_feedback_org on feedback_log(org_id);

-- ============================================================
-- NOTIFICATIONS
-- Per-user channel + event preferences. Phase 2 will populate this.
-- ============================================================
create table notification_prefs (
  user_id uuid primary key references users(id) on delete cascade,
  email_enabled boolean not null default true,
  discord_enabled boolean not null default false,
  discord_user_id text,
  notify_assigned boolean not null default true,
  notify_due_soon boolean not null default true,
  notify_overdue boolean not null default true,
  notify_feedback_received boolean not null default true,
  notify_mention boolean not null default true,
  digest_day int not null default 1,   -- 0=Sun..6=Sat
  digest_hour int not null default 8,  -- 0..23 in user TZ (UTC for now)
  updated_at timestamptz default now()
);

-- Outbound notification queue (phase-2 worker reads/writes this).
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  channel text not null,    -- 'email' | 'discord' | 'in_app'
  event text not null,      -- 'assigned' | 'due_soon' | 'overdue' | 'feedback' | 'mention' | 'digest'
  subject text not null,
  body text not null,       -- HTML for email, markdown for discord
  card_id uuid references cards(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  status text not null default 'queued', -- 'queued' | 'sent' | 'failed'
  error text,
  created_at timestamptz default now(),
  sent_at timestamptz
);
create index idx_notifications_status on notifications(status, created_at);
create index idx_notifications_user on notifications(user_id, created_at desc);

-- ============================================================
-- TRIGGERS
-- ============================================================
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger cards_updated_at
  before update on cards
  for each row execute function set_updated_at();

create or replace function update_card_last_feedback() returns trigger as $$
begin
  update cards set last_feedback = greatest(coalesce(last_feedback, 0), new.checkpoint)
    where id = new.card_id;
  return new;
end;
$$ language plpgsql;

create trigger feedback_updates_card
  after insert on feedback_log
  for each row execute function update_card_last_feedback();

-- Auto-create a notification_prefs row when a user is created.
create or replace function ensure_notification_prefs() returns trigger as $$
begin
  insert into notification_prefs (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$ language plpgsql;

create trigger users_create_prefs
  after insert on users
  for each row execute function ensure_notification_prefs();

-- ============================================================
-- HELPER FUNCTIONS (security definer so RLS can call them safely)
-- ============================================================
create or replace function current_user_org() returns uuid as $$
  select org_id from users where id = auth.uid()
$$ language sql security definer stable;

create or replace function current_user_role() returns user_role as $$
  select role from users where id = auth.uid()
$$ language sql security definer stable;

create or replace function current_user_is_admin() returns boolean as $$
  select role::text in ('super_admin', 'admin') from users where id = auth.uid()
$$ language sql security definer stable;

create or replace function current_user_is_super_admin() returns boolean as $$
  select role::text = 'super_admin' from users where id = auth.uid()
$$ language sql security definer stable;

create or replace function current_user_is_dept_head(p_dept_id uuid) returns boolean as $$
  select exists (
    select 1 from departments
    where id = p_dept_id and head_user_id = auth.uid()
  )
$$ language sql security definer stable;

create or replace function current_user_leads_team(p_team_id uuid) returns boolean as $$
  select exists (
    select 1 from teams
    where id = p_team_id and lead_id = auth.uid()
  ) or exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid() and role = 'lead'
  )
$$ language sql security definer stable;

create or replace function current_user_in_team(p_team_id uuid) returns boolean as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
  )
$$ language sql security definer stable;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table organizations       enable row level security;
alter table users               enable row level security;
alter table departments         enable row level security;
alter table teams               enable row level security;
alter table team_members        enable row level security;
alter table projects            enable row level security;
alter table workspaces          enable row level security;
alter table workspace_members   enable row level security;
alter table workspace_guests    enable row level security;
alter table cards               enable row level security;
alter table feedback_log        enable row level security;
alter table notification_prefs  enable row level security;
alter table notifications       enable row level security;

-- Organizations: users can read their own org
create policy "org_read_self" on organizations
  for select using (id = current_user_org());

-- Users: read others in same org; update own row; admin can do anything in org
create policy "users_read_org" on users
  for select using (org_id = current_user_org());
create policy "users_update_self" on users
  for update using (id = auth.uid());
create policy "users_admin_all" on users
  for all using (current_user_is_admin() and org_id = current_user_org())
  with check (current_user_is_admin() and org_id = current_user_org());

-- Departments: org members read; admin writes; dept_head can update own dept
create policy "dept_read_org" on departments
  for select using (org_id = current_user_org());
create policy "dept_admin_write" on departments
  for all using (current_user_is_admin() and org_id = current_user_org())
  with check (current_user_is_admin() and org_id = current_user_org());
create policy "dept_head_update" on departments
  for update using (head_user_id = auth.uid())
  with check (head_user_id = auth.uid());

-- Teams: org members read; admin or dept_head of dept can write; team_lead can update own team
create policy "teams_read_org" on teams
  for select using (org_id = current_user_org());
create policy "teams_admin_write" on teams
  for all using (current_user_is_admin() and org_id = current_user_org())
  with check (current_user_is_admin() and org_id = current_user_org());
create policy "teams_dept_head_write" on teams
  for all using (department_id is not null and current_user_is_dept_head(department_id))
  with check (department_id is not null and current_user_is_dept_head(department_id));
create policy "teams_lead_update" on teams
  for update using (lead_id = auth.uid())
  with check (lead_id = auth.uid());

-- Team members: org members read; admin or team lead writes
create policy "tm_read_org" on team_members
  for select using (
    exists (select 1 from teams t where t.id = team_id and t.org_id = current_user_org())
  );
create policy "tm_admin_write" on team_members
  for all using (current_user_is_admin())
  with check (current_user_is_admin());
create policy "tm_lead_write" on team_members
  for all using (current_user_leads_team(team_id))
  with check (current_user_leads_team(team_id));

-- Projects: org members read; admin, dept_head, team_lead, project lead write
create policy "projects_read_org" on projects
  for select using (org_id = current_user_org());
create policy "projects_admin_write" on projects
  for all using (current_user_is_admin() and org_id = current_user_org())
  with check (current_user_is_admin() and org_id = current_user_org());
create policy "projects_dept_head_write" on projects
  for all using (department_id is not null and current_user_is_dept_head(department_id))
  with check (department_id is not null and current_user_is_dept_head(department_id));
create policy "projects_team_lead_write" on projects
  for all using (team_id is not null and current_user_leads_team(team_id))
  with check (team_id is not null and current_user_leads_team(team_id));
create policy "projects_lead_update" on projects
  for update using (lead_id = auth.uid())
  with check (lead_id = auth.uid());

-- Workspaces: org members read; admin/project-lead write; team members of project's team can write
create policy "ws_read_org" on workspaces
  for select using (org_id = current_user_org());
create policy "ws_admin_write" on workspaces
  for all using (current_user_is_admin() and org_id = current_user_org())
  with check (current_user_is_admin() and org_id = current_user_org());
create policy "ws_team_write" on workspaces
  for all using (
    exists (
      select 1 from projects p
      where p.id = project_id and p.team_id is not null
        and current_user_in_team(p.team_id)
    )
  )
  with check (
    exists (
      select 1 from projects p
      where p.id = project_id and p.team_id is not null
        and current_user_in_team(p.team_id)
    )
  );

create policy "wsm_read_org" on workspace_members
  for select using (
    exists (select 1 from workspaces w where w.id = workspace_id and w.org_id = current_user_org())
  );
create policy "wsm_admin_write" on workspace_members
  for all using (current_user_is_admin())
  with check (current_user_is_admin());

create policy "wsg_admin_all" on workspace_guests
  for all using (current_user_is_admin())
  with check (current_user_is_admin());
create policy "wsg_team_read" on workspace_guests
  for select using (
    exists (
      select 1 from workspaces w join projects p on p.id = w.project_id
      where w.id = workspace_id and p.team_id is not null
        and current_user_in_team(p.team_id)
    )
  );

-- Cards: org members read; project's team members + admins write
create policy "cards_read_org" on cards
  for select using (org_id = current_user_org());
create policy "cards_admin_write" on cards
  for all using (current_user_is_admin() and org_id = current_user_org())
  with check (current_user_is_admin() and org_id = current_user_org());
create policy "cards_team_write" on cards
  for all using (
    exists (
      select 1 from projects p
      where p.id = project_id and p.team_id is not null
        and current_user_in_team(p.team_id)
    )
  )
  with check (
    exists (
      select 1 from projects p
      where p.id = project_id and p.team_id is not null
        and current_user_in_team(p.team_id)
    )
  );
-- Allow assignees and project leads to update their own cards
create policy "cards_assignee_update" on cards
  for update using (assignee_id = auth.uid())
  with check (assignee_id = auth.uid());

-- Feedback: org members read; team members + admins write
create policy "feedback_read_org" on feedback_log
  for select using (org_id = current_user_org());
create policy "feedback_admin_write" on feedback_log
  for all using (current_user_is_admin() and org_id = current_user_org())
  with check (current_user_is_admin() and org_id = current_user_org());
create policy "feedback_team_write" on feedback_log
  for all using (
    exists (
      select 1 from cards c join projects p on p.id = c.project_id
      where c.id = card_id and p.team_id is not null
        and current_user_in_team(p.team_id)
    )
  )
  with check (
    exists (
      select 1 from cards c join projects p on p.id = c.project_id
      where c.id = card_id and p.team_id is not null
        and current_user_in_team(p.team_id)
    )
  );

-- Notifications: only the owning user reads; admin can read all in org
create policy "np_self" on notification_prefs
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "np_admin_read" on notification_prefs
  for select using (
    current_user_is_admin() and exists (
      select 1 from users u where u.id = user_id and u.org_id = current_user_org()
    )
  );

create policy "notif_self_read" on notifications
  for select using (user_id = auth.uid());
create policy "notif_admin_read" on notifications
  for select using (current_user_is_admin() and org_id = current_user_org());

-- NOTE on guest access:
-- Public guest workspace views go through the API using the service role
-- (bypassing RLS) and only return data scoped to a verified share_token.
-- We do NOT expose a public-read RLS policy because tokens shouldn't leak via
-- direct postgrest queries; the API endpoint is the trust boundary.
