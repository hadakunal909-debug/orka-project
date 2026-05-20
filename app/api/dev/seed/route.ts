import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";

// DEV ONLY — delete this file before going to production.
function isDevAllowed() {
  // Block if NODE_ENV is production OR if running on Vercel (defense in depth).
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") return false;
  return true;
}

export async function POST() {
  if (!isDevAllowed()) {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }

  const admin = createAdminClient();
  const log: string[] = [];
  const err = (msg: string) => { log.push("❌ " + msg); };
  const ok  = (msg: string) => { log.push("✅ " + msg); };

  // ── Step 0: run migration 003 (routing_chain column) ──────
  try {
    await admin.rpc("exec_migration_003" as any);
  } catch {}
  // Use direct REST to add column — fall back silently if already exists
  // We'll just proceed; the column either exists or will be added below
  // via the JS client workaround.

  // ── Step 1: Resolve org ───────────────────────────────────
  const { data: orgs } = await admin.from("organizations").select("id").limit(1);
  const orgId = orgs?.[0]?.id;
  if (!orgId) return NextResponse.json({ error: "No org found. Sign in first.", log }, { status: 400 });
  ok(`Org: ${orgId}`);

  // ── Step 2: Departments ───────────────────────────────────
  const deptColors: Record<string, string> = { HR: "#059669", IT: "#2563EB", Marketing: "#7C3AED" };
  const deptDescs: Record<string, string> = {
    HR: "People, hiring, culture.",
    IT: "Engineering, infra, security.",
    Marketing: "Brand, content, growth.",
  };
  const deptIds: Record<string, string> = {};

  for (const name of ["HR", "IT", "Marketing"]) {
    const { data: existing } = await admin.from("departments").select("id").eq("name", name).eq("org_id", orgId).maybeSingle();
    if (existing) { deptIds[name] = existing.id; ok(`Dept ${name} exists`); continue; }
    const { data, error } = await admin.from("departments")
      .insert({ org_id: orgId, name, description: deptDescs[name], color: deptColors[name] })
      .select("id").single();
    if (error) { err(`Dept ${name}: ${error.message}`); continue; }
    deptIds[name] = data.id;
    ok(`Dept ${name} created`);
  }

  // ── Step 3: Resolve existing users ───────────────────────
  const { data: existingUsers } = await admin.from("users").select("id, email").eq("org_id", orgId);
  const byEmail: Record<string, string> = {};
  (existingUsers || []).forEach((u: any) => { byEmail[u.email] = u.id; });

  const lassya = byEmail["NA@gmail.com"];
  const hritik = byEmail["hritik@projxon.com"];
  const phelan = byEmail["phelan@projxon.com"];

  // Update existing users' departments
  if (lassya) { await admin.from("users").update({ department_id: deptIds["HR"], role: "dept_head" }).eq("id", lassya); ok("Updated Lassya"); }
  if (hritik) { await admin.from("users").update({ department_id: deptIds["IT"], role: "dept_head" }).eq("id", hritik); ok("Updated Hritik"); }
  if (phelan) { await admin.from("users").update({ department_id: deptIds["Marketing"] }).eq("id", phelan); ok("Updated Phelan"); }

  // ── Step 4: New users ─────────────────────────────────────
  const newUsers = [
    { email: "sara.mitchell@projxon.com",  name: "Sara Mitchell", dept: "HR",        role: "team_lead", job_title: "HR Manager",        manager_email: "NA@gmail.com" },
    { email: "james.park@projxon.com",     name: "James Park",    dept: "HR",        role: "member",    job_title: "Recruiter",          manager_email: "sara.mitchell@projxon.com" },
    { email: "priya.sharma@projxon.com",   name: "Priya Sharma",  dept: "HR",        role: "member",    job_title: "L&D Specialist",     manager_email: "sara.mitchell@projxon.com" },
    { email: "marcus.chen@projxon.com",    name: "Marcus Chen",   dept: "IT",        role: "team_lead", job_title: "Backend Lead",       manager_email: "hritik@projxon.com" },
    { email: "aisha.torres@projxon.com",   name: "Aisha Torres",  dept: "IT",        role: "member",    job_title: "Frontend Dev",       manager_email: "marcus.chen@projxon.com" },
    { email: "derek.wong@projxon.com",     name: "Derek Wong",    dept: "IT",        role: "member",    job_title: "DevOps Engineer",    manager_email: "marcus.chen@projxon.com" },
    { email: "sofia.reyes@projxon.com",    name: "Sofia Reyes",   dept: "Marketing", role: "team_lead", job_title: "Content Lead",       manager_email: "phelan@projxon.com" },
    { email: "tom.bradley@projxon.com",    name: "Tom Bradley",   dept: "Marketing", role: "member",    job_title: "SEO Specialist",     manager_email: "sofia.reyes@projxon.com" },
    { email: "keiko.tanaka@projxon.com",   name: "Keiko Tanaka",  dept: "Marketing", role: "member",    job_title: "Social Media Mgr",   manager_email: "sofia.reyes@projxon.com" },
  ];

  for (const u of newUsers) {
    if (byEmail[u.email]) { ok(`User ${u.name} already exists`); continue; }
    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email: u.email, password: "devpassword123", email_confirm: true,
      user_metadata: { name: u.name },
    });
    if (authErr) { err(`Auth user ${u.name}: ${authErr.message}`); continue; }
    const userId = authUser.user.id;
    byEmail[u.email] = userId;
    const managerId = u.manager_email ? byEmail[u.manager_email] : null;
    const { error: profileErr } = await admin.from("users").insert({
      id: userId, email: u.email, name: u.name, org_id: orgId,
      role: u.role, department_id: deptIds[u.dept],
      job_title: u.job_title, manager_id: managerId || null,
    });
    if (profileErr) { err(`Profile ${u.name}: ${profileErr.message}`); } else { ok(`User ${u.name} created`); }
  }

  // Refresh byEmail
  const { data: allUsers } = await admin.from("users").select("id, email, name").eq("org_id", orgId);
  (allUsers || []).forEach((u: any) => { byEmail[u.email] = u.id; });
  const uid = (email: string) => byEmail[email] || null;

  // ── Step 5: Teams ─────────────────────────────────────────
  const teamIds: Record<string, string> = {};
  const teamsData = [
    { name: "People Ops",  dept: "HR",        desc: "Hiring, onboarding, culture.",       lead: "sara.mitchell@projxon.com",  members: ["sara.mitchell@projxon.com","james.park@projxon.com","priya.sharma@projxon.com"] },
    { name: "Engineering", dept: "IT",        desc: "Platform, APIs, infrastructure.",    lead: "marcus.chen@projxon.com",    members: ["marcus.chen@projxon.com","aisha.torres@projxon.com","derek.wong@projxon.com"] },
    { name: "Growth",      dept: "Marketing", desc: "Content, SEO, social, campaigns.",   lead: "sofia.reyes@projxon.com",    members: ["sofia.reyes@projxon.com","tom.bradley@projxon.com","keiko.tanaka@projxon.com"] },
  ];
  for (const t of teamsData) {
    const leadId = uid(t.lead);
    const { data: existing } = await admin.from("teams").select("id").eq("name", t.name).eq("org_id", orgId).maybeSingle();
    let teamId: string;
    if (existing) { teamId = existing.id; ok(`Team ${t.name} exists`); }
    else {
      const { data, error } = await admin.from("teams")
        .insert({ org_id: orgId, department_id: deptIds[t.dept], name: t.name, description: t.desc, lead_id: leadId })
        .select("id").single();
      if (error) { err(`Team ${t.name}: ${error.message}`); continue; }
      teamId = data.id;
      ok(`Team ${t.name} created`);
    }
    teamIds[t.name] = teamId;
    for (const mEmail of t.members) {
      const mId = uid(mEmail);
      if (!mId) continue;
      const isLead = mEmail === t.lead;
      await admin.from("team_members").upsert({ team_id: teamId, user_id: mId, role: isLead ? "lead" : "member" }, { onConflict: "team_id,user_id" });
    }
  }

  // ── Step 6: Projects ──────────────────────────────────────
  const projIds: Record<string, string> = {};
  const projData = [
    { key: "hiring",   team: "People Ops",  dept: "HR",        name: "Q3 Hiring Plan",             desc: "Open 8 roles across 3 departments by end of Q3.",                    lead: "sara.mitchell@projxon.com" },
    { key: "handbook", team: "People Ops",  dept: "HR",        name: "Employee Handbook Refresh",   desc: "Rewrite the handbook to reflect new hybrid policy and benefits.",     lead: "priya.sharma@projxon.com" },
    { key: "platform", team: "Engineering", dept: "IT",        name: "Platform Migration",          desc: "Migrate legacy monolith to microservices. Zero-downtime target.",     lead: "marcus.chen@projxon.com" },
    { key: "security", team: "Engineering", dept: "IT",        name: "API Security Audit",          desc: "Full audit of all public endpoints for auth, rate-limiting, exposure.", lead: "hritik@projxon.com" },
    { key: "content",  team: "Growth",      dept: "Marketing", name: "Q3 Content Calendar",        desc: "12-week editorial plan: blog, social, newsletter.",                   lead: "sofia.reyes@projxon.com" },
    { key: "brand",    team: "Growth",      dept: "Marketing", name: "Brand Refresh",               desc: "Update visual identity: logo, palette, typography, tone of voice.",   lead: "phelan@projxon.com" },
  ];
  for (const p of projData) {
    const leadId = uid(p.lead);
    const { data, error } = await admin.from("projects")
      .insert({ org_id: orgId, team_id: teamIds[p.team], department_id: deptIds[p.dept], name: p.name, description: p.desc, lead_id: leadId, status: "active" })
      .select("id").single();
    if (error) { err(`Project ${p.name}: ${error.message}`); continue; }
    projIds[p.key] = data.id;
    ok(`Project ${p.name} created`);
  }

  // ── Step 7: Cards ─────────────────────────────────────────
  const now = new Date();
  const d = (days: number) => new Date(now.getTime() + days * 86400000).toISOString().split("T")[0];

  const cards = [
    // HR — Hiring
    { proj: "hiring",   title: "Define role specs for Eng hires",        stage: "front_burner", progress: 55, priority: "high",   assignee: "sara.mitchell@projxon.com",   due: d(7),   notes: "Working with Marcus on JD drafts. Need sign-off from Lassya." },
    { proj: "hiring",   title: "Source candidates — Backend Lead",        stage: "prep_table",   progress: 20, priority: "high",   assignee: "james.park@projxon.com",      due: d(21),  notes: "LinkedIn Recruiter + referral network. Target 20 screened." },
    { proj: "hiring",   title: "Schedule panel interviews — UX round",    stage: "on_order",     progress: 5,  priority: "medium", assignee: "james.park@projxon.com",      due: d(30),  notes: "Waiting on calendar availability from design team." },
    { proj: "hiring",   title: "Offer letter template update",            stage: "pass_qa",      progress: 88, priority: "low",    assignee: "priya.sharma@projxon.com",    due: d(3),   notes: "Legal reviewed. Minor edits on compensation table." },
    // HR — Handbook
    { proj: "handbook", title: "Hybrid policy chapter",                   stage: "front_burner", progress: 60, priority: "high",   assignee: "priya.sharma@projxon.com",    due: d(10),  notes: "Drafted. Needs Lassya approval then HR all-hands review." },
    { proj: "handbook", title: "Benefits & perks section",                stage: "prep_table",   progress: 30, priority: "medium", assignee: "priya.sharma@projxon.com",    due: d(18),  notes: "Pulling latest numbers from payroll. Need 2024 healthcare rates." },
    { proj: "handbook", title: "Onboarding checklist revamp",             stage: "served",       progress: 100,priority: "low",    assignee: "sara.mitchell@projxon.com",   due: d(-5),  notes: "Published to Notion. Linked from welcome email template." },
    { proj: "handbook", title: "Manager guide: performance reviews",      stage: "on_order",     progress: 8,  priority: "medium", assignee: "sara.mitchell@projxon.com",   due: d(45),  notes: "Kick-off meeting scheduled for next week." },
    // IT — Platform
    { proj: "platform", title: "Auth service extraction",                 stage: "front_burner", progress: 70, priority: "high",   assignee: "marcus.chen@projxon.com",     due: d(5),   notes: "OAuth2 + JWT. 70% done. Rate limiting still TODO." },
    { proj: "platform", title: "User service API contract",               stage: "pass_qa",      progress: 85, priority: "high",   assignee: "aisha.torres@projxon.com",    due: d(2),   notes: "OpenAPI spec finalised. Integration tests passing." },
    { proj: "platform", title: "Database connection pooling",             stage: "front_burner", progress: 50, priority: "medium", assignee: "derek.wong@projxon.com",      due: d(12),  notes: "PgBouncer config in staging. Need prod load test." },
    { proj: "platform", title: "CI/CD pipeline for new services",         stage: "prep_table",   progress: 25, priority: "high",   assignee: "derek.wong@projxon.com",      due: d(8),   notes: "GitHub Actions + ArgoCD. Needs secrets management." },
    { proj: "platform", title: "Deprecate legacy monolith endpoints",     stage: "on_order",     progress: 0,  priority: "low",    assignee: "marcus.chen@projxon.com",     due: d(60),  notes: "Blocked until new services are prod-stable." },
    // IT — Security
    { proj: "security", title: "Enumerate all public endpoints",          stage: "served",       progress: 100,priority: "medium", assignee: "hritik@projxon.com",          due: d(-10), notes: "Postman collection exported. 147 endpoints documented." },
    { proj: "security", title: "Fix rate limiting on /api/auth/*",        stage: "pass_qa",      progress: 90, priority: "high",   assignee: "marcus.chen@projxon.com",     due: d(-1),  notes: "Redis-based throttle deployed to staging. Pen-test scheduled." },
    { proj: "security", title: "OWASP Top 10 gap analysis",               stage: "front_burner", progress: 45, priority: "high",   assignee: "aisha.torres@projxon.com",    due: d(6),   notes: "A03 (Injection) and A07 (Auth failures) still open." },
    { proj: "security", title: "Data masking for dev environments",       stage: "prep_table",   progress: 15, priority: "medium", assignee: "derek.wong@projxon.com",      due: d(20),  notes: "PII fields in dev DB are still real data. Needs script." },
    // Marketing — Content
    { proj: "content",  title: "Week 1-4 blog topics brief",              stage: "served",       progress: 100,priority: "medium", assignee: "sofia.reyes@projxon.com",     due: d(-7),  notes: "Brief approved. Writers assigned. Drafts due Friday." },
    { proj: "content",  title: "SEO keyword map — Q3",                    stage: "front_burner", progress: 65, priority: "high",   assignee: "tom.bradley@projxon.com",     due: d(4),   notes: "Ahrefs export done. Gap analysis in progress." },
    { proj: "content",  title: "Newsletter template redesign",            stage: "prep_table",   progress: 30, priority: "medium", assignee: "keiko.tanaka@projxon.com",    due: d(14),  notes: "Figma mockups shared. Waiting on brand kit." },
    { proj: "content",  title: "Social post library — LinkedIn",          stage: "front_burner", progress: 50, priority: "medium", assignee: "keiko.tanaka@projxon.com",    due: d(9),   notes: "80 posts drafted. Needs proofreading + scheduling." },
    { proj: "content",  title: "Q3 campaign landing page",                stage: "on_order",     progress: 5,  priority: "high",   assignee: "tom.bradley@projxon.com",     due: d(28),  notes: "Brief from Phelan expected EOW." },
    // Marketing — Brand
    { proj: "brand",    title: "Brand audit — current assets",            stage: "served",       progress: 100,priority: "medium", assignee: "sofia.reyes@projxon.com",     due: d(-14), notes: "Full inventory of 200+ assets done. Findings deck shared." },
    { proj: "brand",    title: "New logo concepts (3 directions)",         stage: "pass_qa",      progress: 92, priority: "high",   assignee: "phelan@projxon.com",          due: d(1),   notes: "Agency presented. Direction B selected. Final files pending." },
    { proj: "brand",    title: "Colour palette & typography guide",        stage: "front_burner", progress: 60, priority: "high",   assignee: "sofia.reyes@projxon.com",     due: d(7),   notes: "Primary + secondary palette locked. Font pairing in review." },
    { proj: "brand",    title: "Tone of voice playbook",                   stage: "prep_table",   progress: 20, priority: "medium", assignee: "tom.bradley@projxon.com",     due: d(21),  notes: "Draft outline approved. Writing persona examples next." },
    { proj: "brand",    title: "Brand rollout comms plan",                 stage: "on_order",     progress: 0,  priority: "low",    assignee: "keiko.tanaka@projxon.com",    due: d(35),  notes: "Blocked until assets finalised." },
  ];

  const cardIds: Record<string, string> = {};
  for (const c of cards) {
    if (!projIds[c.proj]) { err(`Card '${c.title}' — no project ${c.proj}`); continue; }
    const assigneeId = uid(c.assignee);
    const { data, error } = await admin.from("cards").insert({
      org_id: orgId, project_id: projIds[c.proj], title: c.title,
      stage: c.stage, progress: c.progress, priority: c.priority,
      assignee_id: assigneeId, due_date: c.due, notes: c.notes,
    }).select("id").single();
    if (error) { err(`Card ${c.title}: ${error.message}`); continue; }
    cardIds[c.title] = data.id;
    ok(`Card: ${c.title}`);
  }

  // ── Step 8: Feedback threads ──────────────────────────────
  const at = (daysAgo: number, hoursAgo = 0) =>
    new Date(now.getTime() - daysAgo * 86400000 - hoursAgo * 3600000).toISOString();

  const threads = [
    {
      cardTitle: "Auth service extraction",
      reviewer: "marcus.chen@projxon.com", reviewerName: "Marcus Chen",
      checkpoint: 50, lens: "Execution",
      note: "Auth service is at 70% but rate limiting logic is still missing. The OAuth token refresh flow also has an edge case when the refresh token is expired — it returns a 500 instead of a 401.",
      next_action: "Fix the 500 error first, then add Redis-based rate limiting before moving to pass_qa.",
      assignee: "hritik@projxon.com", status: "pending_response",
      chain: [
        { from: "marcus.chen@projxon.com", fromName: "Marcus Chen", to: "hritik@projxon.com", note: "Routing to Hritik for PM review — need to decide if rate limiting is in scope for this sprint.", action: "routed", at: at(2) },
      ],
    },
    {
      cardTitle: "OWASP Top 10 gap analysis",
      reviewer: "aisha.torres@projxon.com", reviewerName: "Aisha Torres",
      checkpoint: 30, lens: "Feasible",
      note: "The A03 injection vulnerability in the /search endpoint is more severe than initially scoped. It requires a full parameterised query rewrite across 12 files, not just the 3 we planned.",
      next_action: "Need exec sign-off to expand scope. Block the endpoint in prod until fixed.",
      assignee: "NA@gmail.com", status: "pending_response",
      chain: [
        { from: "aisha.torres@projxon.com", fromName: "Aisha Torres", to: "hritik@projxon.com", note: "Flagging to Hritik first — this changes the sprint plan.", action: "routed", at: at(3) },
        { from: "hritik@projxon.com", fromName: "Hritik", to: "NA@gmail.com", note: "Agreed this needs leadership sign-off. Routing to Lassya for security policy decision.", action: "routed", at: at(1) },
      ],
    },
    {
      cardTitle: "Hybrid policy chapter",
      reviewer: "priya.sharma@projxon.com", reviewerName: "Priya Sharma",
      checkpoint: 50, lens: "Clarity",
      note: "The hybrid policy chapter is drafted but the language around 'core hours' is ambiguous. It says employees must be online 10am-3pm but doesn't clarify timezone. We have team members in 4 time zones.",
      next_action: "Decide on timezone anchor (HQ local time vs employee local time) before publishing.",
      assignee: "sara.mitchell@projxon.com", status: "pending_response",
      chain: [
        { from: "priya.sharma@projxon.com", fromName: "Priya Sharma", to: "sara.mitchell@projxon.com", note: "Sara, can you review and make the call on timezone policy?", action: "routed", at: at(0, 4) },
      ],
    },
    {
      cardTitle: "SEO keyword map — Q3",
      reviewer: "tom.bradley@projxon.com", reviewerName: "Tom Bradley",
      checkpoint: 50, lens: "Deliverables",
      note: "The keyword map has 3 clusters competing for the same SERP intent. If we publish all three we'll be cannibalising our own rankings. Need to prioritise one cluster per month.",
      next_action: "Pick the primary cluster for July and park the others for Aug/Sep.",
      assignee: "sofia.reyes@projxon.com", status: "pending_response",
      chain: [
        { from: "tom.bradley@projxon.com", fromName: "Tom Bradley", to: "sofia.reyes@projxon.com", note: "Sofia, your call on which cluster to lead with — it should align with the campaign theme.", action: "routed", at: at(0, 6) },
      ],
    },
    {
      cardTitle: "New logo concepts (3 directions)",
      reviewer: "phelan@projxon.com", reviewerName: "Phelan",
      checkpoint: 90, lens: "Key Next Step",
      note: "Direction B is the strongest but the wordmark feels heavy at small sizes. The 'P' letterform also looks too similar to our competitor's mark.",
      next_action: "Ask agency for 2 wordmark refinements and a competitive audit before final sign-off.",
      assignee: "sofia.reyes@projxon.com", status: "responded",
      response: "Spoke with the agency — they'll send revised wordmark options by Thursday. Competitive audit will take 2 days.",
      chain: [
        { from: "phelan@projxon.com", fromName: "Phelan", to: "sofia.reyes@projxon.com", note: "Sofia, please chase the agency on this.", action: "routed", at: at(2) },
        { from: "sofia.reyes@projxon.com", fromName: "Sofia Reyes", to: null, note: "Spoke with the agency — they'll send revised wordmark options by Thursday. Competitive audit will take 2 days.", action: "responded", at: at(0, 1) },
      ],
    },
    {
      cardTitle: "CI/CD pipeline for new services",
      reviewer: "derek.wong@projxon.com", reviewerName: "Derek Wong",
      checkpoint: 10, lens: "Assumptions",
      note: "I assumed we'd use HashiCorp Vault for secrets management, but I found we already have AWS Secrets Manager set up. Using both would be redundant and adds cost.",
      next_action: "Decide: standardise on AWS Secrets Manager or migrate to Vault for portability?",
      assignee: "marcus.chen@projxon.com", status: "pending_response",
      chain: [
        { from: "derek.wong@projxon.com", fromName: "Derek Wong", to: "marcus.chen@projxon.com", note: "Marcus, this is an architecture call — happy to go either way.", action: "routed", at: at(0, 5) },
      ],
    },
  ];

  for (const t of threads) {
    const cardId = cardIds[t.cardTitle];
    if (!cardId) { err(`Feedback: no card '${t.cardTitle}'`); continue; }
    const reviewerId = uid(t.reviewer);
    const assigneeId = uid(t.assignee);
    const chain = t.chain.map((step) => ({
      from_id: uid(step.from),
      from_name: step.fromName,
      to_id: step.to ? uid(step.to) : null,
      note: step.note,
      action: step.action,
      at: step.at,
    }));
    const insert: any = {
      org_id: orgId, card_id: cardId,
      reviewer_id: reviewerId, reviewer_name: t.reviewerName,
      checkpoint: t.checkpoint, lens: t.lens, note: t.note,
      next_action: t.next_action, assigned_to_id: assigneeId,
      status: t.status, routing_chain: chain,
    };
    if (t.response) { insert.response = t.response; insert.responded_at = at(0, 1); }
    let { error } = await admin.from("feedback_log").insert(insert);
    // If routing_chain column missing (migration 003 not yet run), retry without it
    if (error?.message?.includes("routing_chain")) {
      const { routing_chain: _, ...withoutChain } = insert;
      const retry = await admin.from("feedback_log").insert(withoutChain);
      error = retry.error;
      if (!error) ok(`Feedback thread (no chain): ${t.cardTitle}`);
    } else if (!error) {
      ok(`Feedback thread: ${t.cardTitle}`);
    }
    if (error) err(`Feedback for '${t.cardTitle}': ${error.message}`);
  }

  return NextResponse.json({ success: true, log });
}
