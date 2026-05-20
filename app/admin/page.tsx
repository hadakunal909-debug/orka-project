import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import AdminClient from "@/components/AdminClient";

export default async function AdminPage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await sb
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "super_admin"].includes(profile.role)) redirect("/dashboard");

  const [usersRes, deptsRes, teamsRes, teamMembersRes, projectsRes, workspacesRes] = await Promise.all([
    sb.from("users").select("id, email, name, avatar_url, role, department_id, job_title, created_at").order("created_at"),
    sb.from("departments").select("*").order("name"),
    sb.from("teams").select("*").order("name"),
    sb.from("team_members").select("*"),
    sb.from("projects").select("*").order("created_at"),
    sb.from("workspaces").select("*").order("created_at"),
  ]);

  return (
    <AdminClient
      profile={profile}
      initialUsers={usersRes.data ?? []}
      initialDepartments={deptsRes.data ?? []}
      initialTeams={teamsRes.data ?? []}
      initialTeamMembers={teamMembersRes.data ?? []}
      initialProjects={projectsRes.data ?? []}
      initialWorkspaces={workspacesRes.data ?? []}
    />
  );
}
