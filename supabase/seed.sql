-- Optional seed data for development. Run AFTER you've signed in once
-- so a user row exists.
--
-- Promotes the first user to super admin and creates sample departments,
-- teams, projects, a workspace, and a few cards.

do $$
declare
  v_org_id uuid;
  v_user_id uuid;
  v_dept_marketing uuid;
  v_dept_it uuid;
  v_team_growth uuid;
  v_project_id uuid;
  v_workspace_id uuid;
begin
  select id, org_id into v_user_id, v_org_id from users limit 1;
  if v_user_id is null then
    raise notice 'No users yet. Sign in first, then re-run.';
    return;
  end if;

  -- Make first user a super admin
  update users set role = 'super_admin' where id = v_user_id;

  -- Departments
  insert into departments (org_id, name, description, color, head_user_id)
  values (v_org_id, 'Marketing', 'Brand, content, growth.', '#7C3AED', v_user_id)
  returning id into v_dept_marketing;

  insert into departments (org_id, name, description, color, head_user_id)
  values (v_org_id, 'IT', 'Engineering, infra, security.', '#2563EB', v_user_id)
  returning id into v_dept_it;

  insert into departments (org_id, name, description, color)
  values (v_org_id, 'HR', 'People, hiring, culture.', '#059669');

  -- Team
  insert into teams (org_id, department_id, name, description, lead_id)
  values (v_org_id, v_dept_marketing, 'Growth', 'Acquisition + lifecycle marketing.', v_user_id)
  returning id into v_team_growth;

  insert into team_members (team_id, user_id, role)
  values (v_team_growth, v_user_id, 'lead');

  -- Project
  insert into projects (org_id, team_id, department_id, name, description, lead_id)
  values (v_org_id, v_team_growth, v_dept_marketing, 'Q2 Acme launch', 'External campaign for Acme Corp.', v_user_id)
  returning id into v_project_id;

  -- Workspace (client-facing) — share token must be enabled via the API
  insert into workspaces (org_id, project_id, name, description, is_public)
  values (v_org_id, v_project_id, 'Acme Corp — Q2 launch', 'Live status of your campaign.', false)
  returning id into v_workspace_id;

  -- Cards
  insert into cards (org_id, project_id, title, stage, progress, priority, assignee_id, due_date, notes)
  values
    (v_org_id, v_project_id, 'Define campaign brief',           'prep_table',  25, 'high',   v_user_id, current_date + 14, 'Need clarity on positioning.'),
    (v_org_id, v_project_id, 'Landing page copy v1',            'front_burner',55, 'medium', v_user_id, current_date + 7,  'Got 50% feedback. Tightening.'),
    (v_org_id, v_project_id, 'Migrate paid-ads templates',      'on_order',     5, 'low',    v_user_id, current_date + 30, 'Awaiting greenlight.'),
    (v_org_id, v_project_id, 'Email drip — week 1',             'pass_qa',     85, 'medium', v_user_id, current_date + 3,  'QA in progress.');

  raise notice 'Seed complete. Open /admin to see it.';
end $$;
