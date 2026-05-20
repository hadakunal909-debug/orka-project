import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import DashboardClient from "@/components/DashboardClient";
import { filterAccessibleCards, filterAccessibleFeedback, getAccessibleProjectIds, isAdmin } from "@/lib/access";

export default async function DashboardPage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/");

  const [
    profileRes,
    deptsRes,
    teamsRes,
    teamMembersRes,
    projectsRes,
    projectAccessRes,
    workspacesRes,
    cardsRes,
    feedbackRes,
    usersRes,
  ] = await Promise.all([
    sb.from("users")
      .select("id, email, name, avatar_url, org_id, role, department_id, job_title, manager_id, last_seen_at, e2e_public_key")
      .eq("id", user.id)
      .single(),
    sb.from("departments").select("*").order("name", { ascending: true }),
    sb.from("teams").select("*").order("name", { ascending: true }),
    sb.from("team_members").select("*"),
    sb.from("projects").select("*").order("created_at", { ascending: true }),
    sb.from("project_access").select("project_id, user_id"),
    sb.from("workspaces").select("*").order("created_at", { ascending: true }),
    sb.from("cards").select("*").order("created_at", { ascending: false }),
    sb.from("feedback_log").select("*").order("created_at", { ascending: false }),
    sb.from("users")
      .select("id, email, name, avatar_url, role, department_id, job_title, manager_id, last_seen_at, e2e_public_key"),
  ]);

  const profile = profileRes.data!;
  const departments = deptsRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const teamMembers = teamMembersRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const cards = cardsRes.data ?? [];

  const accessibleProjectIds = getAccessibleProjectIds({
    profile,
    departments,
    teams,
    teamMembers,
    projects,
    projectAccess: projectAccessRes.data ?? [],
  });
  const visibleProjects = isAdmin(profile)
    ? projects
    : projects.filter((p) => accessibleProjectIds.has(p.id));
  const visibleCards = filterAccessibleCards({
    profile,
    cards,
    accessibleProjectIds,
  });
  const visibleCardIds = new Set(visibleCards.map((c) => c.id));
  const visibleFeedback = filterAccessibleFeedback(feedbackRes.data ?? [], visibleCardIds, profile);
  const visibleDepartmentIds = new Set(visibleProjects.map((p) => p.department_id).filter(Boolean) as string[]);
  if (profile.department_id) visibleDepartmentIds.add(profile.department_id);
  const visibleTeamIds = new Set(visibleProjects.map((p) => p.team_id).filter(Boolean) as string[]);
  const visibleDepartments = isAdmin(profile) ? departments : departments.filter((d) => visibleDepartmentIds.has(d.id));
  const visibleTeams = isAdmin(profile) ? teams : teams.filter((t) => visibleTeamIds.has(t.id) || (t.department_id && visibleDepartmentIds.has(t.department_id)));
  const visibleTeamMembers = isAdmin(profile) ? teamMembers : teamMembers.filter((m) => visibleTeamIds.has(m.team_id) || m.user_id === profile.id);
  const visibleUserIds = new Set<string>([profile.id]);
  visibleCards.forEach((c) => { if (c.assignee_id) visibleUserIds.add(c.assignee_id); });
  visibleProjects.forEach((p) => { if (p.lead_id) visibleUserIds.add(p.lead_id); });
  visibleDepartments.forEach((d) => { if (d.head_user_id) visibleUserIds.add(d.head_user_id); });
  visibleTeamMembers.forEach((m) => visibleUserIds.add(m.user_id));
  const visibleUsers = isAdmin(profile)
    ? usersRes.data ?? []
    : (usersRes.data ?? []).filter((u) => visibleUserIds.has(u.id));
  const visibleWorkspaces = isAdmin(profile)
    ? workspacesRes.data ?? []
    : (workspacesRes.data ?? []).filter((w) => w.is_public || accessibleProjectIds.has(w.project_id));

  // Touch last_seen_at for the current user (fire-and-forget)
  sb.rpc("touch_last_seen", { p_user_id: user.id }).then(() => {});

  return (
    <DashboardClient
      profile={profile}
      initialDepartments={visibleDepartments}
      initialTeams={visibleTeams}
      initialTeamMembers={visibleTeamMembers}
      initialProjects={visibleProjects}
      initialWorkspaces={visibleWorkspaces}
      initialCards={visibleCards}
      initialFeedback={visibleFeedback}
      orgUsers={visibleUsers}
    />
  );
}
