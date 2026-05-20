-- ============================================================
-- Hypothetical seed data — realistic users, teams, projects,
-- cards, and feedback chains across all departments.
--
-- Run AFTER schema.sql and migrations 001-003.
-- Run in Supabase SQL Editor.
-- ============================================================

do $$
declare
  v_org_id       uuid;

  -- Departments
  v_dept_hr      uuid;
  v_dept_it      uuid;
  v_dept_mktg    uuid;

  -- Auth / profile IDs for new users (generated fresh)
  v_sara         uuid := gen_random_uuid();
  v_james        uuid := gen_random_uuid();
  v_priya        uuid := gen_random_uuid();
  v_marcus       uuid := gen_random_uuid();
  v_aisha        uuid := gen_random_uuid();
  v_derek        uuid := gen_random_uuid();
  v_sofia        uuid := gen_random_uuid();
  v_tom          uuid := gen_random_uuid();
  v_keiko        uuid := gen_random_uuid();

  -- Existing users (looked up below)
  v_lassya       uuid;
  v_hritik       uuid;
  v_phelan       uuid;

  -- Teams
  v_team_people  uuid;
  v_team_eng     uuid;
  v_team_growth  uuid;

  -- Projects
  v_proj_hiring  uuid;
  v_proj_handbook uuid;
  v_proj_platform uuid;
  v_proj_security uuid;
  v_proj_content  uuid;
  v_proj_brand    uuid;

begin
  -- ── Resolve org ───────────────────────────────────────────
  select id into v_org_id from organizations limit 1;
  if v_org_id is null then
    raise exception 'No organization found. Sign in first.';
  end if;

  -- ── Resolve existing departments ──────────────────────────
  select id into v_dept_hr   from departments where name = 'HR'        and org_id = v_org_id limit 1;
  select id into v_dept_it   from departments where name = 'IT'        and org_id = v_org_id limit 1;
  select id into v_dept_mktg from departments where name = 'Marketing' and org_id = v_org_id limit 1;

  -- Create any missing departments
  if v_dept_hr is null then
    insert into departments (org_id, name, description, color)
    values (v_org_id, 'HR', 'People, hiring, culture.', '#059669')
    returning id into v_dept_hr;
  end if;
  if v_dept_it is null then
    insert into departments (org_id, name, description, color)
    values (v_org_id, 'IT', 'Engineering, infra, security.', '#2563EB')
    returning id into v_dept_it;
  end if;
  if v_dept_mktg is null then
    insert into departments (org_id, name, description, color)
    values (v_org_id, 'Marketing', 'Brand, content, growth.', '#7C3AED')
    returning id into v_dept_mktg;
  end if;

  -- ── Resolve existing users ────────────────────────────────
  select id into v_lassya from users where email = 'NA@gmail.com'          and org_id = v_org_id limit 1;
  select id into v_hritik from users where email = 'hritik@projxon.com'    and org_id = v_org_id limit 1;
  select id into v_phelan from users where email = 'phelan@projxon.com'    and org_id = v_org_id limit 1;

  -- ── Create auth stubs + profiles for new users ───────────
  -- We insert directly into public.users; the auth.users rows
  -- will be auto-created when they first log in via dev-signin.
  -- We use the generated UUIDs as their future auth.users IDs.

  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data, aud, role)
  values
    (v_sara,   'sara.mitchell@projxon.com',  now(), now(), now(), '{"name":"Sara Mitchell"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_james,  'james.park@projxon.com',     now(), now(), now(), '{"name":"James Park"}'::jsonb,     '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_priya,  'priya.sharma@projxon.com',   now(), now(), now(), '{"name":"Priya Sharma"}'::jsonb,   '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_marcus, 'marcus.chen@projxon.com',    now(), now(), now(), '{"name":"Marcus Chen"}'::jsonb,    '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_aisha,  'aisha.torres@projxon.com',   now(), now(), now(), '{"name":"Aisha Torres"}'::jsonb,   '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_derek,  'derek.wong@projxon.com',     now(), now(), now(), '{"name":"Derek Wong"}'::jsonb,     '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_sofia,  'sofia.reyes@projxon.com',    now(), now(), now(), '{"name":"Sofia Reyes"}'::jsonb,    '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_tom,    'tom.bradley@projxon.com',    now(), now(), now(), '{"name":"Tom Bradley"}'::jsonb,    '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_keiko,  'keiko.tanaka@projxon.com',   now(), now(), now(), '{"name":"Keiko Tanaka"}'::jsonb,   '{}'::jsonb, 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  -- ── Profiles ──────────────────────────────────────────────
  insert into users (id, email, name, org_id, role, department_id, job_title, manager_id)
  values
    -- HR
    (v_sara,   'sara.mitchell@projxon.com', 'Sara Mitchell', v_org_id, 'team_lead', v_dept_hr,   'HR Manager',         v_lassya),
    (v_james,  'james.park@projxon.com',    'James Park',    v_org_id, 'member',    v_dept_hr,   'Recruiter',          v_sara),
    (v_priya,  'priya.sharma@projxon.com',  'Priya Sharma',  v_org_id, 'member',    v_dept_hr,   'L&D Specialist',     v_sara),
    -- IT
    (v_marcus, 'marcus.chen@projxon.com',   'Marcus Chen',   v_org_id, 'team_lead', v_dept_it,   'Backend Lead',       v_hritik),
    (v_aisha,  'aisha.torres@projxon.com',  'Aisha Torres',  v_org_id, 'member',    v_dept_it,   'Frontend Dev',       v_marcus),
    (v_derek,  'derek.wong@projxon.com',    'Derek Wong',    v_org_id, 'member',    v_dept_it,   'DevOps Engineer',    v_marcus),
    -- Marketing
    (v_sofia,  'sofia.reyes@projxon.com',   'Sofia Reyes',   v_org_id, 'team_lead', v_dept_mktg, 'Content Lead',       v_phelan),
    (v_tom,    'tom.bradley@projxon.com',   'Tom Bradley',   v_org_id, 'member',    v_dept_mktg, 'SEO Specialist',     v_sofia),
    (v_keiko,  'keiko.tanaka@projxon.com',  'Keiko Tanaka',  v_org_id, 'member',    v_dept_mktg, 'Social Media Mgr',   v_sofia)
  on conflict (id) do update set
    name = excluded.name, department_id = excluded.department_id,
    job_title = excluded.job_title, manager_id = excluded.manager_id;

  -- Update existing users' departments if missing
  update users set department_id = v_dept_hr   where id = v_lassya and department_id is null;
  update users set department_id = v_dept_it   where id = v_hritik and department_id is null;
  update users set department_id = v_dept_mktg where id = v_phelan and department_id is null;
  update users set role = 'dept_head' where id = v_lassya and role <> 'super_admin';
  update users set role = 'dept_head' where id = v_hritik and role <> 'super_admin';

  -- ── Teams ─────────────────────────────────────────────────
  insert into teams (org_id, department_id, name, description, lead_id)
  values (v_org_id, v_dept_hr,   'People Ops',   'Hiring, onboarding, culture.',        v_sara)
  returning id into v_team_people;

  insert into teams (org_id, department_id, name, description, lead_id)
  values (v_org_id, v_dept_it,   'Engineering',  'Platform, APIs, infrastructure.',     v_marcus)
  returning id into v_team_eng;

  insert into teams (org_id, department_id, name, description, lead_id)
  values (v_org_id, v_dept_mktg, 'Growth',       'Content, SEO, social, campaigns.',    v_sofia)
  returning id into v_team_growth;

  -- Team members
  insert into team_members (team_id, user_id, role) values
    (v_team_people, v_sara,   'lead'),
    (v_team_people, v_james,  'member'),
    (v_team_people, v_priya,  'member'),
    (v_team_eng,    v_marcus, 'lead'),
    (v_team_eng,    v_aisha,  'member'),
    (v_team_eng,    v_derek,  'member'),
    (v_team_growth, v_sofia,  'lead'),
    (v_team_growth, v_tom,    'member'),
    (v_team_growth, v_keiko,  'member')
  on conflict do nothing;

  -- ── Projects ──────────────────────────────────────────────
  insert into projects (org_id, team_id, department_id, name, description, lead_id, status)
  values (v_org_id, v_team_people, v_dept_hr, 'Q3 Hiring Plan', 'Open 8 roles across 3 departments by end of Q3.', v_sara, 'active')
  returning id into v_proj_hiring;

  insert into projects (org_id, team_id, department_id, name, description, lead_id, status)
  values (v_org_id, v_team_people, v_dept_hr, 'Employee Handbook Refresh', 'Rewrite the handbook to reflect new hybrid policy and benefits.', v_priya, 'active')
  returning id into v_proj_handbook;

  insert into projects (org_id, team_id, department_id, name, description, lead_id, status)
  values (v_org_id, v_team_eng, v_dept_it, 'Platform Migration', 'Migrate legacy monolith to microservices. Target: zero downtime.', v_marcus, 'active')
  returning id into v_proj_platform;

  insert into projects (org_id, team_id, department_id, name, description, lead_id, status)
  values (v_org_id, v_team_eng, v_dept_it, 'API Security Audit', 'Full audit of all public endpoints for auth, rate-limiting, and data exposure.', v_hritik, 'active')
  returning id into v_proj_security;

  insert into projects (org_id, team_id, department_id, name, description, lead_id, status)
  values (v_org_id, v_team_growth, v_dept_mktg, 'Q3 Content Calendar', '12-week editorial plan: blog, social, newsletter.', v_sofia, 'active')
  returning id into v_proj_content;

  insert into projects (org_id, team_id, department_id, name, description, lead_id, status)
  values (v_org_id, v_team_growth, v_dept_mktg, 'Brand Refresh', 'Update visual identity: logo, palette, typography, and tone of voice guide.', v_phelan, 'active')
  returning id into v_proj_brand;

  -- ── Cards — HR / People Ops ───────────────────────────────
  insert into cards (org_id, project_id, title, stage, progress, priority, assignee_id, due_date, notes) values
    (v_org_id, v_proj_hiring, 'Define role specs for Eng hires',       'front_burner', 55, 'high',   v_sara,   current_date + 7,  'Working with Marcus on JD drafts. Need sign-off from Lassya.'),
    (v_org_id, v_proj_hiring, 'Source candidates — Backend Lead',      'prep_table',   20, 'high',   v_james,  current_date + 21, 'LinkedIn Recruiter + referral network. Target 20 screened.'),
    (v_org_id, v_proj_hiring, 'Schedule panel interviews — UX round',  'on_order',      5, 'medium', v_james,  current_date + 30, 'Waiting on calendar availability from design team.'),
    (v_org_id, v_proj_hiring, 'Offer letter template update',          'pass_qa',      88, 'low',    v_priya,  current_date + 3,  'Legal reviewed. Minor edits on compensation table.'),
    (v_org_id, v_proj_handbook, 'Hybrid policy chapter',               'front_burner', 60, 'high',   v_priya,  current_date + 10, 'Drafted. Needs Lassya approval then HR all-hands review.'),
    (v_org_id, v_proj_handbook, 'Benefits & perks section',            'prep_table',   30, 'medium', v_priya,  current_date + 18, 'Pulling latest numbers from payroll. Need 2024 healthcare rates.'),
    (v_org_id, v_proj_handbook, 'Onboarding checklist revamp',         'served',       100,'low',    v_sara,   current_date - 5,  'Published to Notion. Linked from welcome email template.'),
    (v_org_id, v_proj_handbook, 'Manager guide: performance reviews',  'on_order',      8, 'medium', v_sara,   current_date + 45, 'Kick-off meeting scheduled for next week.');

  -- ── Cards — IT / Engineering ──────────────────────────────
  insert into cards (org_id, project_id, title, stage, progress, priority, assignee_id, due_date, notes) values
    (v_org_id, v_proj_platform, 'Auth service extraction',             'front_burner', 70, 'high',   v_marcus, current_date + 5,  'OAuth2 + JWT. 70% done. Rate limiting still TODO.'),
    (v_org_id, v_proj_platform, 'User service API contract',           'pass_qa',      85, 'high',   v_aisha,  current_date + 2,  'OpenAPI spec finalised. Integration tests passing.'),
    (v_org_id, v_proj_platform, 'Database connection pooling',         'front_burner', 50, 'medium', v_derek,  current_date + 12, 'PgBouncer config in staging. Need prod load test.'),
    (v_org_id, v_proj_platform, 'CI/CD pipeline for new services',     'prep_table',   25, 'high',   v_derek,  current_date + 8,  'GitHub Actions + ArgoCD. Needs secrets management.'),
    (v_org_id, v_proj_platform, 'Deprecate legacy monolith endpoints', 'on_order',      0, 'low',    v_marcus, current_date + 60, 'Blocked until new services are prod-stable.'),
    (v_org_id, v_proj_security, 'Enumerate all public endpoints',      'served',       100,'medium', v_hritik, current_date - 10, 'Postman collection exported. 147 endpoints documented.'),
    (v_org_id, v_proj_security, 'Fix rate limiting on /api/auth/*',    'pass_qa',      90, 'high',   v_marcus, current_date - 1,  'Redis-based throttle deployed to staging. Pen-test scheduled.'),
    (v_org_id, v_proj_security, 'OWASP Top 10 gap analysis',           'front_burner', 45, 'high',   v_aisha,  current_date + 6,  'A03 (Injection) and A07 (Auth failures) still open.'),
    (v_org_id, v_proj_security, 'Data masking for dev environments',   'prep_table',   15, 'medium', v_derek,  current_date + 20, 'PII fields in dev DB are still real data. Needs script.');

  -- ── Cards — Marketing / Growth ────────────────────────────
  insert into cards (org_id, project_id, title, stage, progress, priority, assignee_id, due_date, notes) values
    (v_org_id, v_proj_content, 'Week 1-4 blog topics brief',           'served',       100,'medium', v_sofia,  current_date - 7,  'Brief approved. Writers assigned. Drafts due Friday.'),
    (v_org_id, v_proj_content, 'SEO keyword map — Q3',                 'front_burner', 65, 'high',   v_tom,    current_date + 4,  'Ahrefs export done. Gap analysis in progress.'),
    (v_org_id, v_proj_content, 'Newsletter template redesign',         'prep_table',   30, 'medium', v_keiko,  current_date + 14, 'Figma mockups shared. Waiting on brand kit from brand project.'),
    (v_org_id, v_proj_content, 'Social post library — LinkedIn',       'front_burner', 50, 'medium', v_keiko,  current_date + 9,  '80 posts drafted. Needs proofreading + scheduling.'),
    (v_org_id, v_proj_content, 'Q3 campaign landing page',             'on_order',      5, 'high',   v_tom,    current_date + 28, 'Brief from Phelan expected EOW.'),
    (v_org_id, v_proj_brand,   'Brand audit — current assets',         'served',       100,'medium', v_sofia,  current_date - 14, 'Full inventory of 200+ assets done. Findings deck shared.'),
    (v_org_id, v_proj_brand,   'New logo concepts (3 directions)',      'pass_qa',      92, 'high',   v_phelan, current_date + 1,  'Agency presented. Direction B selected. Final files pending.'),
    (v_org_id, v_proj_brand,   'Colour palette & typography guide',    'front_burner', 60, 'high',   v_sofia,  current_date + 7,  'Primary + secondary palette locked. Font pairing in review.'),
    (v_org_id, v_proj_brand,   'Tone of voice playbook',               'prep_table',   20, 'medium', v_tom,    current_date + 21, 'Draft outline approved. Writing persona examples next.'),
    (v_org_id, v_proj_brand,   'Brand rollout comms plan',             'on_order',      0, 'low',    v_keiko,  current_date + 35, 'Blocked until assets finalised.');

  -- ── Feedback entries with routing chains ──────────────────

  -- 1. Auth service: Marcus → Hritik → Aisha (routed twice)
  insert into feedback_log (org_id, card_id, reviewer_id, reviewer_name, checkpoint, lens, note, next_action, assigned_to_id, status, routing_chain)
  select v_org_id, c.id, v_marcus, 'Marcus Chen', 50, 'Execution',
    'Auth service is at 70% but rate limiting logic is still missing. The OAuth token refresh flow also has an edge case when the refresh token is expired — it returns a 500 instead of a 401.',
    'Fix the 500 error first, then add Redis-based rate limiting before moving to pass_qa.',
    v_hritik, 'pending_response',
    jsonb_build_array(
      jsonb_build_object('from_id', v_marcus, 'from_name', 'Marcus Chen', 'to_id', v_hritik,
        'note', 'Routing to Hritik for PM review — need to decide if rate limiting is in scope for this sprint.',
        'action', 'routed', 'at', (now() - interval '2 days')::text)
    )
  from cards c where c.title = 'Auth service extraction' and c.org_id = v_org_id limit 1;

  -- 2. OWASP gap analysis: Aisha flagged → Hritik assigned → Lassya (security policy owner)
  insert into feedback_log (org_id, card_id, reviewer_id, reviewer_name, checkpoint, lens, note, next_action, assigned_to_id, status, routing_chain)
  select v_org_id, c.id, v_aisha, 'Aisha Torres', 30, 'Feasible',
    'The A03 injection vulnerability in the /search endpoint is more severe than initially scoped. It requires a full parameterised query rewrite across 12 files, not just the 3 we planned.',
    'Need exec sign-off to expand scope. Block the endpoint in prod until fixed.',
    v_lassya, 'pending_response',
    jsonb_build_array(
      jsonb_build_object('from_id', v_aisha, 'from_name', 'Aisha Torres', 'to_id', v_hritik,
        'note', 'Flagging to Hritik first — this changes the sprint plan.',
        'action', 'routed', 'at', (now() - interval '3 days')::text),
      jsonb_build_object('from_id', v_hritik, 'from_name', 'Hritik', 'to_id', v_lassya,
        'note', 'Agreed this needs leadership sign-off. Routing to Lassya for security policy decision.',
        'action', 'routed', 'at', (now() - interval '1 day')::text)
    )
  from cards c where c.title = 'OWASP Top 10 gap analysis' and c.org_id = v_org_id limit 1;

  -- 3. Hybrid policy: Priya → Sara → Lassya (dept head approval)
  insert into feedback_log (org_id, card_id, reviewer_id, reviewer_name, checkpoint, lens, note, next_action, assigned_to_id, status, routing_chain)
  select v_org_id, c.id, v_priya, 'Priya Sharma', 50, 'Clarity',
    'The hybrid policy chapter is drafted but the language around "core hours" is ambiguous. It says employees must be online 10am-3pm but doesn''t clarify timezone. We have team members in 4 time zones.',
    'Decide on timezone anchor (HQ local time vs employee local time) before publishing.',
    v_sara, 'pending_response',
    jsonb_build_array(
      jsonb_build_object('from_id', v_priya, 'from_name', 'Priya Sharma', 'to_id', v_sara,
        'note', 'Sara, can you review and make the call on timezone policy?',
        'action', 'routed', 'at', (now() - interval '4 hours')::text)
    )
  from cards c where c.title = 'Hybrid policy chapter' and c.org_id = v_org_id limit 1;

  -- 4. SEO keyword map: Tom → Sofia (content strategy alignment)
  insert into feedback_log (org_id, card_id, reviewer_id, reviewer_name, checkpoint, lens, note, next_action, assigned_to_id, status, routing_chain)
  select v_org_id, c.id, v_tom, 'Tom Bradley', 50, 'Deliverables',
    'The keyword map has 3 clusters competing for the same SERP intent. If we publish all three we''ll be cannibalising our own rankings. Need to prioritise one cluster per month.',
    'Pick the primary cluster for July and park the others for Aug/Sep.',
    v_sofia, 'pending_response',
    jsonb_build_array(
      jsonb_build_object('from_id', v_tom, 'from_name', 'Tom Bradley', 'to_id', v_sofia,
        'note', 'Sofia, your call on which cluster to lead with — it should align with the campaign theme.',
        'action', 'routed', 'at', (now() - interval '6 hours')::text)
    )
  from cards c where c.title = 'SEO keyword map — Q3' and c.org_id = v_org_id limit 1;

  -- 5. Logo concepts: Phelan responded, now resolved
  insert into feedback_log (org_id, card_id, reviewer_id, reviewer_name, checkpoint, lens, note, next_action, assigned_to_id, response, responded_at, status, routing_chain)
  select v_org_id, c.id, v_phelan, 'Phelan', 90, 'Key Next Step',
    'Direction B is the strongest but the wordmark feels heavy at small sizes. The "P" letterform also looks too similar to our competitor''s mark.',
    'Ask agency for 2 wordmark refinements and a competitive audit before final sign-off.',
    v_sofia, 'Spoke with the agency — they''ll send revised wordmark options by Thursday. Competitive audit will take 2 days.', now() - interval '1 hour',
    'responded',
    jsonb_build_array(
      jsonb_build_object('from_id', v_phelan, 'from_name', 'Phelan', 'to_id', v_sofia,
        'note', 'Sofia, please chase the agency on this.',
        'action', 'routed', 'at', (now() - interval '2 days')::text),
      jsonb_build_object('from_id', v_sofia, 'from_name', 'Sofia Reyes', 'to_id', null,
        'note', 'Spoke with the agency — they''ll send revised wordmark options by Thursday. Competitive audit will take 2 days.',
        'action', 'responded', 'at', (now() - interval '1 hour')::text)
    )
  from cards c where c.title = 'New logo concepts (3 directions)' and c.org_id = v_org_id limit 1;

  -- 6. CI/CD pipeline: Derek → Marcus (technical decision needed)
  insert into feedback_log (org_id, card_id, reviewer_id, reviewer_name, checkpoint, lens, note, next_action, assigned_to_id, status, routing_chain)
  select v_org_id, c.id, v_derek, 'Derek Wong', 10, 'Assumptions',
    'I assumed we''d use HashiCorp Vault for secrets management, but I found we already have AWS Secrets Manager set up. Using both would be redundant and adds cost.',
    'Decide: standardise on AWS Secrets Manager or migrate to Vault for portability?',
    v_marcus, 'pending_response',
    jsonb_build_array(
      jsonb_build_object('from_id', v_derek, 'from_name', 'Derek Wong', 'to_id', v_marcus,
        'note', 'Marcus, this is an architecture call — happy to go either way.',
        'action', 'routed', 'at', (now() - interval '5 hours')::text)
    )
  from cards c where c.title = 'CI/CD pipeline for new services' and c.org_id = v_org_id limit 1;

  raise notice 'Hypothetical seed complete. % users, 6 projects, 27 cards, 6 feedback threads created.', 9;
end $$;
