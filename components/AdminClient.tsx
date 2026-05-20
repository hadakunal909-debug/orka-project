"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Building2, Users as UsersIcon, FolderKanban, Globe, UserCog,
  Plus, Trash2, X, Copy, Check, Link as LinkIcon, ShieldCheck,
  Network, Eye, Key, Mail, Briefcase, ChevronRight, UserPlus,
  RotateCcw, MessageSquare, Clock, AlertTriangle,
} from "lucide-react";
import type {
  User, Department, Team, TeamMember, Project, Workspace, UserRole, ProjectVisibility,
} from "@/lib/types";

type AdminUser = Pick<User, "id" | "email" | "name" | "avatar_url" | "role" | "department_id"> & {
  job_title?: string | null;
  created_at?: string;
};

type Props = {
  profile: User;
  initialUsers: AdminUser[];
  initialDepartments: Department[];
  initialTeams: Team[];
  initialTeamMembers: TeamMember[];
  initialProjects: Project[];
  initialWorkspaces: Workspace[];
};

type Tab = "users" | "departments" | "teams" | "projects" | "workspaces" | "org-chart" | "delete-log";

export default function AdminClient(props: Props) {
  const [tab, setTab] = useState<Tab>("departments");
  const [users, setUsers] = useState(props.initialUsers);
  const [departments, setDepartments] = useState(props.initialDepartments);
  const [teams, setTeams] = useState(props.initialTeams);
  const [teamMembers, setTeamMembers] = useState(props.initialTeamMembers);
  const [projects, setProjects] = useState(props.initialProjects);
  const [workspaces, setWorkspaces] = useState(props.initialWorkspaces);

  const tabs: { id: Tab; label: string; icon: any; count: number }[] = [
    { id: "departments", label: "Departments", icon: Building2, count: departments.length },
    { id: "teams", label: "Teams", icon: UsersIcon, count: teams.length },
    { id: "projects", label: "Projects", icon: FolderKanban, count: projects.length },
    { id: "workspaces", label: "Workspaces", icon: Globe, count: workspaces.length },
    { id: "users", label: "People", icon: UserCog, count: users.length },
    { id: "org-chart", label: "Org Chart", icon: Network, count: 0 },
    { id: "delete-log", label: "Delete Log", icon: Trash2, count: 0 },
  ];

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)" }}>
      <header className="bg-white/90 backdrop-blur-xl border-b border-line/60 sticky top-0 z-30"
        style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link href="/dashboard" className="text-mute hover:text-primary p-1.5 rounded-lg hover:bg-primary/5 transition-all duration-150">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center shadow-sm">
              <ShieldCheck size={15} className="text-white" />
            </div>
            <h1 className="text-lg font-extrabold text-ink tracking-tight">Admin</h1>
          </div>
          <div className="ml-auto text-xs text-mute font-medium">{profileSubtitle(props.profile)}</div>
        </div>
        <nav className="max-w-6xl mx-auto px-6 flex gap-0.5">
          {tabs.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-all duration-150 ${active ? "text-primary border-primary font-semibold" : "text-mute border-transparent hover:text-ink hover:border-line/40"}`}>
                <Icon size={14} strokeWidth={active ? 2.4 : 2} />
                {t.label}
                {t.count > 0 && <span className={`text-[10px] font-mono px-1.5 py-px rounded-md ${active ? "bg-primary/10 text-primary" : "bg-bg text-mute/70"}`}>{t.count}</span>}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {tab === "departments" && (
          <DepartmentsTab
            departments={departments} setDepartments={setDepartments}
            users={users}
          />
        )}
        {tab === "teams" && (
          <TeamsTab
            teams={teams} setTeams={setTeams}
            teamMembers={teamMembers} setTeamMembers={setTeamMembers}
            departments={departments} users={users}
          />
        )}
        {tab === "projects" && (
          <ProjectsTab
            projects={projects} setProjects={setProjects}
            teams={teams} departments={departments} users={users}
          />
        )}
        {tab === "workspaces" && (
          <WorkspacesTab
            workspaces={workspaces} setWorkspaces={setWorkspaces}
            projects={projects}
          />
        )}
        {tab === "users" && (
          <UsersTab
            users={users} setUsers={setUsers}
            departments={departments}
            teams={teams}
            teamMembers={teamMembers}
            currentUserId={props.profile.id}
            canManageSuperAdmin={props.profile.role === "super_admin"}
          />
        )}
        {tab === "org-chart" && (
          <OrgChartTab
            users={users}
            departments={departments}
            teams={teams}
            teamMembers={teamMembers}
          />
        )}
        {tab === "delete-log" && (
          <DeleteLogTab />
        )}
      </main>
    </div>
  );
}

function profileSubtitle(p: User) {
  return `Signed in as ${p.name || p.email}`;
}

// ===========================================================
// DEPARTMENTS
// ===========================================================
function DepartmentsTab({
  departments, setDepartments, users,
}: {
  departments: Department[];
  setDepartments: React.Dispatch<React.SetStateAction<Department[]>>;
  users: AdminUser[];
}) {
  const [showNew, setShowNew] = useState(false);

  const remove = async (id: string) => {
    if (!confirm("Delete this department? Projects in it will be unlinked.")) return;
    const r = await fetch(`/api/departments/${id}`, { method: "DELETE" });
    if (!r.ok) { alert("Delete failed"); return; }
    setDepartments(prev => prev.filter(d => d.id !== id));
  };

  return (
    <SectionShell title="Departments" desc="Top-level org structure (HR, IT, Marketing, …)."
      action={<NewBtn onClick={() => setShowNew(true)} label="New department" />}>
      <Table headers={["Name", "Head", "Color", ""]}>
        {departments.length === 0 && (
          <EmptyRow colSpan={4} text="No departments yet." />
        )}
        {departments.map(d => {
          const head = users.find(u => u.id === d.head_user_id);
          return (
            <tr key={d.id} className="border-b border-line text-sm">
              <td className="px-3 py-2.5">
                <div className="font-medium text-ink">{d.name}</div>
                {d.description && <div className="text-xs text-soft mt-0.5">{d.description}</div>}
              </td>
              <td className="px-3 py-2.5 text-soft text-xs">{head?.name || head?.email || "—"}</td>
              <td className="px-3 py-2.5">
                <span className="inline-block w-4 h-4 rounded border border-line" style={{ background: d.color }} />
              </td>
              <td className="px-3 py-2.5 text-right">
                <button onClick={() => remove(d.id)} className="text-mute hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          );
        })}
      </Table>

      {showNew && (
        <Modal title="New department" onClose={() => setShowNew(false)}>
          <DepartmentForm
            users={users}
            onSubmit={async (input) => {
              const r = await fetch("/api/departments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              if (!r.ok) { alert("Create failed"); return; }
              const { department } = await r.json();
              setDepartments(prev => [...prev, department].sort((a, b) => a.name.localeCompare(b.name)));
              setShowNew(false);
            }} />
        </Modal>
      )}
    </SectionShell>
  );
}

function DepartmentForm({ users, onSubmit }: { users: AdminUser[]; onSubmit: (input: any) => Promise<void>; }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#2563EB");
  const [headId, setHeadId] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      color,
      head_user_id: headId || null,
    });
  };

  return (
    <>
      <FormField label="Name">
        <input value={name} onChange={e => setName(e.target.value)} autoFocus
          className="form-input" placeholder="e.g. Marketing" />
      </FormField>
      <FormField label="Description (optional)">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
          className="form-input" />
      </FormField>
      <div className="flex gap-3">
        <FormField label="Color">
          <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-20" />
        </FormField>
        <FormField label="Department head">
          <select value={headId} onChange={e => setHeadId(e.target.value)} className="form-input">
            <option value="">—</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
        </FormField>
      </div>
      <FormActions onSubmit={submit} />
    </>
  );
}

// ===========================================================
// TEAMS
// ===========================================================
function TeamsTab({
  teams, setTeams, teamMembers, setTeamMembers, departments, users,
}: {
  teams: Team[];
  setTeams: React.Dispatch<React.SetStateAction<Team[]>>;
  teamMembers: TeamMember[];
  setTeamMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
  departments: Department[];
  users: AdminUser[];
}) {
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [editingDetails, setEditingDetails] = useState<Team | null>(null);

  const remove = async (id: string) => {
    if (!confirm("Delete this team? Projects assigned to it will be unlinked.")) return;
    const r = await fetch(`/api/teams/${id}`, { method: "DELETE" });
    if (!r.ok) { alert("Delete failed"); return; }
    setTeams(prev => prev.filter(t => t.id !== id));
    setTeamMembers(prev => prev.filter(m => m.team_id !== id));
  };

  return (
    <SectionShell title="Teams" desc="Project teams. May span departments."
      action={<NewBtn onClick={() => setShowNew(true)} label="New team" />}>
      <Table headers={["Name", "Department", "Lead", "Members", ""]}>
        {teams.length === 0 && <EmptyRow colSpan={5} text="No teams yet." />}
        {teams.map(t => {
          const dept = departments.find(d => d.id === t.department_id);
          const lead = users.find(u => u.id === t.lead_id);
          const members = teamMembers.filter(m => m.team_id === t.id);
          return (
            <tr key={t.id} className="border-b border-line text-sm">
              <td className="px-3 py-2.5 font-medium text-ink">{t.name}</td>
              <td className="px-3 py-2.5 text-xs">
                {dept ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: dept.color }} />
                    {dept.name}
                  </span>
                ) : <span className="text-mute">—</span>}
              </td>
              <td className="px-3 py-2.5 text-xs text-soft">{lead?.name || lead?.email || "—"}</td>
              <td className="px-3 py-2.5">
                <button onClick={() => setEditing(t)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary border border-line bg-white rounded hover:bg-bg">
                  {members.length} <span className="text-mute">manage</span>
                </button>
              </td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => setEditingDetails(t)}
                    className="text-mute hover:text-primary p-1 rounded hover:bg-primary/5"
                    title="Edit team">
                    <UserCog size={14} />
                  </button>
                  <button onClick={() => remove(t.id)}
                    className="text-mute hover:text-danger p-1 rounded hover:bg-danger/5"
                    title="Delete team">
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </Table>

      {showNew && (
        <Modal title="New team" onClose={() => setShowNew(false)}>
          <TeamForm departments={departments} users={users}
            onSubmit={async (input) => {
              const r = await fetch("/api/teams", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              if (!r.ok) { alert("Create failed"); return; }
              const { team } = await r.json();
              setTeams(prev => [...prev, team].sort((a, b) => a.name.localeCompare(b.name)));
              if (team.lead_id) {
                setTeamMembers(prev => [
                  ...prev,
                  { team_id: team.id, user_id: team.lead_id, role: "lead", added_at: new Date().toISOString() },
                ]);
              }
              setShowNew(false);
            }} />
        </Modal>
      )}

      {editingDetails && (
        <Modal title={`Edit team — ${editingDetails.name}`} onClose={() => setEditingDetails(null)}>
          <TeamForm departments={departments} users={users} initial={editingDetails}
            onSubmit={async (input) => {
              const r = await fetch(`/api/teams/${editingDetails.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              if (!r.ok) { alert("Update failed"); return; }
              const { team } = await r.json();
              setTeams(prev => prev.map(t => t.id === team.id ? team : t).sort((a, b) => a.name.localeCompare(b.name)));
              setEditingDetails(null);
            }} />
        </Modal>
      )}

      {editing && (
        <Modal title={`${editing.name} — members`} onClose={() => setEditing(null)}>
          <TeamMembersEditor team={editing} users={users}
            members={teamMembers.filter(m => m.team_id === editing.id)}
            onAdd={async (userId) => {
              const r = await fetch(`/api/teams/${editing.id}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId }),
              });
              if (!r.ok) { alert("Add failed"); return; }
              const { member } = await r.json();
              setTeamMembers(prev => [...prev.filter(m => !(m.team_id === member.team_id && m.user_id === member.user_id)), member]);
            }}
            onRemove={async (userId) => {
              const r = await fetch(`/api/teams/${editing.id}/members?user_id=${userId}`, { method: "DELETE" });
              if (!r.ok) { alert("Remove failed"); return; }
              setTeamMembers(prev => prev.filter(m => !(m.team_id === editing.id && m.user_id === userId)));
            }} />
        </Modal>
      )}
    </SectionShell>
  );
}

function TeamForm({ departments, users, onSubmit, initial }: {
  departments: Department[]; users: AdminUser[];
  onSubmit: (input: any) => Promise<void>;
  initial?: Team;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [departmentId, setDepartmentId] = useState(initial?.department_id ?? "");
  const [leadId, setLeadId] = useState(initial?.lead_id ?? "");

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: description?.trim() || null,
      department_id: departmentId || null,
      lead_id: leadId || null,
    });
  };

  return (
    <>
      <FormField label="Name">
        <input value={name} onChange={e => setName(e.target.value)} autoFocus className="form-input" placeholder="e.g. Frontend Platform" />
      </FormField>
      <FormField label="Description (optional)">
        <textarea value={description ?? ""} onChange={e => setDescription(e.target.value)} rows={2} className="form-input" />
      </FormField>
      <div className="flex gap-3">
        <FormField label="Department">
          <select value={departmentId ?? ""} onChange={e => setDepartmentId(e.target.value)} className="form-input">
            <option value="">— (cross-dept)</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FormField>
        <FormField label="Team lead">
          <select value={leadId ?? ""} onChange={e => setLeadId(e.target.value)} className="form-input">
            <option value="">—</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </FormField>
      </div>
      <FormActions onSubmit={submit} submitLabel={initial ? "Save changes" : "Create"} />
    </>
  );
}

function TeamMembersEditor({ team, users, members, onAdd, onRemove }: {
  team: Team; users: AdminUser[]; members: TeamMember[];
  onAdd: (userId: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}) {
  const memberIds = new Set(members.map(m => m.user_id));
  const [picker, setPicker] = useState("");

  const candidates = users.filter(u => !memberIds.has(u.id));

  return (
    <>
      <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
        {members.length === 0 && <div className="text-xs text-mute italic py-2">No members yet.</div>}
        {members.map(m => {
          const u = users.find(x => x.id === m.user_id);
          return (
            <div key={m.user_id} className="flex items-center gap-2 px-2.5 py-1.5 border border-line rounded bg-white text-sm">
              <span className="flex-1 truncate">{u?.name || u?.email || m.user_id}</span>
              <span className="text-[10.5px] font-semibold uppercase text-mute">{m.role}</span>
              <button onClick={() => onRemove(m.user_id)} className="text-mute hover:text-red-600">
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mt-3">
        <select value={picker} onChange={e => setPicker(e.target.value)} className="form-input flex-1">
          <option value="">Add member…</option>
          {candidates.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
        <button onClick={() => { if (picker) { onAdd(picker); setPicker(""); } }}
          className="px-3 py-1.5 bg-primary text-white text-sm font-semibold rounded">Add</button>
      </div>
    </>
  );
}

// ===========================================================
// PROJECTS
// ===========================================================
function ProjectsTab({
  projects, setProjects, teams, departments, users,
}: {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  teams: Team[]; departments: Department[]; users: AdminUser[];
}) {
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const remove = async (id: string) => {
    if (!confirm("Delete this project and all its cards and feedback?")) return;
    const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!r.ok) { alert("Delete failed"); return; }
    setProjects(prev => prev.filter(p => p.id !== id));
  };

  return (
    <SectionShell title="Projects" desc="Units of work owned by a team."
      action={<NewBtn onClick={() => setShowNew(true)} label="New project" />}>
      <Table headers={["Name", "Department", "Team", "Lead", "Status", ""]}>
        {projects.length === 0 && <EmptyRow colSpan={6} text="No projects yet." />}
        {projects.map(p => {
          const dept = departments.find(d => d.id === p.department_id);
          const team = teams.find(t => t.id === p.team_id);
          const lead = users.find(u => u.id === p.lead_id);
          return (
            <tr key={p.id} className="border-b border-line text-sm hover:bg-bg">
              <td className="px-3 py-2.5 font-medium text-ink">{p.name}</td>
              <td className="px-3 py-2.5 text-xs">
                {dept ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: dept.color }} />
                    {dept.name}
                  </span>
                ) : <span className="text-mute">—</span>}
              </td>
              <td className="px-3 py-2.5 text-xs">{team ? team.name : <span className="text-mute">—</span>}</td>
              <td className="px-3 py-2.5 text-xs text-soft">{lead?.name || lead?.email || "—"}</td>
              <td className="px-3 py-2.5 text-xs">
                <span className="inline-block px-1.5 py-0.5 rounded bg-bg text-soft font-mono">{p.status}</span>
              </td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => setEditing(p)}
                    className="text-mute hover:text-primary p-1 rounded hover:bg-primary/5"
                    title="Edit project">
                    <UserCog size={14} />
                  </button>
                  <button onClick={() => remove(p.id)}
                    className="text-mute hover:text-danger p-1 rounded hover:bg-danger/5"
                    title="Delete project">
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </Table>

      {showNew && (
        <Modal title="New project" onClose={() => setShowNew(false)}>
          <ProjectForm teams={teams} departments={departments} users={users}
            onSubmit={async (input) => {
              const r = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              if (!r.ok) { alert("Create failed"); return; }
              const { project } = await r.json();
              setProjects(prev => [...prev, project]);
              setShowNew(false);
            }} />
        </Modal>
      )}

      {editing && (
        <div onClick={() => setEditing(null)}
          className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-5"
          style={{ animation: "fadeIn 0.1s ease" }}>
          <div onClick={e => e.stopPropagation()}
            className="bg-white/95 backdrop-blur-xl rounded-2xl w-full max-w-[680px] overflow-hidden max-h-[90vh] flex flex-col animate-modalIn"
            style={{ boxShadow: "0 24px 64px -16px rgba(15,23,42,0.2), 0 8px 24px -8px rgba(15,23,42,0.1), 0 0 0 1px rgba(255,255,255,0.6) inset" }}>
            <div className="flex justify-between items-center px-5 py-3.5 border-b border-line/50 bg-gradient-to-r from-[#FAFBFC] to-white">
              <span className="text-sm font-semibold text-ink">{"Edit project \u2014 "}{editing.name}</span>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg text-soft hover:text-ink hover:bg-bg transition-all"><X size={15} /></button>
            </div>
            <div className="overflow-y-auto p-4 flex flex-col gap-4">
              <ProjectForm
                teams={teams}
                departments={departments}
                users={users}
                initial={editing}
                onSubmit={async (input) => {
                  const r = await fetch(`/api/projects/${editing.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(input),
                  });
                  if (!r.ok) { alert("Update failed"); return; }
                  const { project } = await r.json();
                  setProjects(prev => prev.map(p => p.id === project.id ? project : p));
                  setEditing(null);
                }} />
              <div className="border-t border-line pt-4">
                <ProjectMembersSection projectId={editing.id} users={users} />
              </div>
            </div>
          </div>
        </div>
      )}
    </SectionShell>
  );
}

function ProjectForm({ teams, departments, users, onSubmit, initial }: {
  teams: Team[]; departments: Department[]; users: AdminUser[];
  onSubmit: (input: any) => Promise<void>;
  initial?: Project;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [teamId, setTeamId] = useState(initial?.team_id ?? "");
  const [departmentId, setDepartmentId] = useState(initial?.department_id ?? "");
  const [leadId, setLeadId] = useState(initial?.lead_id ?? "");
  const [status, setStatus] = useState<"active" | "paused" | "archived">(
    (initial?.status as any) ?? "active"
  );
  const [visibility, setVisibility] = useState<ProjectVisibility>(
    (initial?.visibility as any) ?? "org"
  );

  // Auto-fill department when team is picked, if team has one.
  const onTeam = (id: string) => {
    setTeamId(id);
    const t = teams.find(x => x.id === id);
    if (t?.department_id) setDepartmentId(t.department_id);
  };

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: description?.trim() || null,
      team_id: teamId || null,
      department_id: departmentId || null,
      lead_id: leadId || null,
      status,
      visibility,
    });
  };

  return (
    <>
      <FormField label="Project name">
        <input value={name} onChange={e => setName(e.target.value)} autoFocus className="form-input" />
      </FormField>
      <FormField label="Description (optional)">
        <textarea value={description ?? ""} onChange={e => setDescription(e.target.value)} rows={2} className="form-input" />
      </FormField>
      <div className="flex gap-3">
        <FormField label="Team">
          <select value={teamId ?? ""} onChange={e => onTeam(e.target.value)} className="form-input">
            <option value="">—</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </FormField>
        <FormField label="Department">
          <select value={departmentId ?? ""} onChange={e => setDepartmentId(e.target.value)} className="form-input">
            <option value="">—</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FormField>
      </div>
      <div className="flex gap-3">
        <FormField label="Project lead / owner">
          <select value={leadId ?? ""} onChange={e => setLeadId(e.target.value)} className="form-input">
            <option value="">—</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </FormField>
        <FormField label="Status">
          <select value={status} onChange={e => setStatus(e.target.value as any)} className="form-input">
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </FormField>
      </div>
      <FormField label="Visibility">
        <div className="flex gap-2">
          {([
            { id: "private" as const, label: "Private", desc: "Only shared members" },
            { id: "team" as const, label: "Team", desc: "Team members" },
            { id: "org" as const, label: "Organization", desc: "Everyone" },
          ]).map(v => (
            <button key={v.id} type="button" onClick={() => setVisibility(v.id)}
              className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold text-center transition-all ${
                visibility === v.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-line bg-white text-soft hover:border-slate-300"
              }`}>
              <div>{v.label}</div>
              <div className="text-[10px] font-normal mt-0.5 opacity-70">{v.desc}</div>
            </button>
          ))}
        </div>
      </FormField>
      <FormActions onSubmit={submit} submitLabel={initial ? "Save changes" : "Create"} />
    </>
  );
}

// ===========================================================
// PROJECT MEMBERS (sharing)
// ===========================================================
type ProjectMember = { project_id: string; user_id: string; role: string; added_at: string };

function ProjectMembersSection({ projectId, users }: { projectId: string; users: AdminUser[] }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"viewer" | "editor" | "owner">("viewer");

  useEffect(() => {
    fetch(`/api/projects/${projectId}/members`)
      .then(r => r.json())
      .then(j => setMembers(j.members || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const addMember = async () => {
    if (!addUserId) return;
    const r = await fetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: addUserId, role: addRole }),
    });
    if (!r.ok) { alert("Failed to add member"); return; }
    const { member } = await r.json();
    setMembers(prev => {
      const exists = prev.find(m => m.user_id === member.user_id);
      if (exists) return prev.map(m => m.user_id === member.user_id ? member : m);
      return [...prev, member];
    });
    setAddUserId("");
    setAddRole("viewer");
  };

  const removeMember = async (userId: string) => {
    const r = await fetch(`/api/projects/${projectId}/members?user_id=${userId}`, { method: "DELETE" });
    if (!r.ok) { alert("Failed to remove member"); return; }
    setMembers(prev => prev.filter(m => m.user_id !== userId));
  };

  const nonMembers = users.filter(u => !members.some(m => m.user_id === u.id));

  const roleBadge = (role: string) => {
    const styles: Record<string, string> = {
      owner: "bg-amber-100 text-amber-700 border-amber-200",
      editor: "bg-blue-50 text-blue-700 border-blue-200",
      viewer: "bg-slate-100 text-slate-600 border-slate-200",
    };
    return styles[role] || styles.viewer;
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <UsersIcon size={14} className="text-primary" />
        <span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Shared with</span>
        <span className="text-[10.5px] font-mono text-soft">{members.length}</span>
      </div>

      {loading && <div className="text-xs text-mute py-2">Loading…</div>}

      {!loading && members.length === 0 && (
        <div className="text-xs text-mute italic py-2">No members shared yet. Add people below.</div>
      )}

      <div className="flex flex-col gap-1.5 mb-3">
        {members.map(m => {
          const user = users.find(u => u.id === m.user_id);
          return (
            <div key={m.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-[#FAFBFC] border border-line group">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                {(user?.name || user?.email || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-ink truncate">{user?.name || user?.email || m.user_id}</div>
                {user?.email && user?.name && <div className="text-[10px] text-mute truncate">{user.email}</div>}
              </div>
              <select
                value={m.role}
                onChange={async (e) => {
                  const newRole = e.target.value as "viewer" | "editor" | "owner";
                  const r = await fetch(`/api/projects/${projectId}/members`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ user_id: m.user_id, role: newRole }),
                  });
                  if (r.ok) {
                    const { member } = await r.json();
                    setMembers(prev => prev.map(x => x.user_id === member.user_id ? member : x));
                  }
                }}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer ${roleBadge(m.role)}`}>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
              <button onClick={() => removeMember(m.user_id)}
                className="opacity-0 group-hover:opacity-100 text-mute hover:text-red-500 transition-all p-1">
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 p-2 rounded-lg border border-dashed border-line bg-white">
        <UserPlus size={14} className="text-mute flex-shrink-0" />
        <select value={addUserId} onChange={e => setAddUserId(e.target.value)}
          className="flex-1 px-2 py-1 border border-line rounded bg-white text-xs text-ink">
          <option value="">Add a person…</option>
          {nonMembers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
        <select value={addRole} onChange={e => setAddRole(e.target.value as any)}
          className="px-2 py-1 border border-line rounded bg-white text-[10.5px] font-semibold text-soft">
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="owner">Owner</option>
        </select>
        <button onClick={addMember} disabled={!addUserId}
          className="px-3 py-1 bg-brand-grad text-white text-[11px] font-bold rounded-lg disabled:opacity-40 transition">
          Add
        </button>
      </div>
    </div>
  );
}

// ===========================================================
// WORKSPACES
// ===========================================================
function WorkspacesTab({
  workspaces, setWorkspaces, projects,
}: {
  workspaces: Workspace[];
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  projects: Project[];
}) {
  const [showNew, setShowNew] = useState(false);

  const remove = async (id: string) => {
    if (!confirm("Delete this workspace? The share link will stop working.")) return;
    const r = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    if (!r.ok) { alert("Delete failed"); return; }
    setWorkspaces(prev => prev.filter(w => w.id !== id));
  };

  const enableShare = async (id: string) => {
    const r = await fetch(`/api/workspaces/${id}/share`, { method: "POST" });
    if (!r.ok) { alert("Enable failed"); return; }
    const { workspace } = await r.json();
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, ...workspace } : w));
  };

  const disableShare = async (id: string) => {
    if (!confirm("Revoke the public share link?")) return;
    const r = await fetch(`/api/workspaces/${id}/share`, { method: "DELETE" });
    if (!r.ok) { alert("Revoke failed"); return; }
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, share_token: null, is_public: false } : w));
  };

  return (
    <SectionShell title="Workspaces" desc="Client-facing project views with optional public share link."
      action={<NewBtn onClick={() => setShowNew(true)} label="New workspace" />}>
      <div className="grid gap-3">
        {workspaces.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-mute italic bg-white border border-line rounded">
            No workspaces yet.
          </div>
        )}
        {workspaces.map(w => {
          const project = projects.find(p => p.id === w.project_id);
          return (
            <div key={w.id} className="bg-white border border-line rounded p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink">{w.name}</div>
                  <div className="text-xs text-soft mt-0.5">Project: {project?.name || "—"}</div>
                  {w.description && <div className="text-xs text-soft mt-1.5 leading-relaxed">{w.description}</div>}
                </div>
                <button onClick={() => remove(w.id)} className="text-mute hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-3 pt-3 border-t border-line">
                <ShareControls workspace={w} onEnable={() => enableShare(w.id)} onDisable={() => disableShare(w.id)} />
              </div>
            </div>
          );
        })}
      </div>

      {showNew && (
        <Modal title="New workspace" onClose={() => setShowNew(false)}>
          <WorkspaceForm projects={projects}
            onSubmit={async (input) => {
              const r = await fetch("/api/workspaces", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              if (!r.ok) { alert("Create failed"); return; }
              const { workspace } = await r.json();
              setWorkspaces(prev => [...prev, workspace]);
              setShowNew(false);
            }} />
        </Modal>
      )}
    </SectionShell>
  );
}

function WorkspaceForm({ projects, onSubmit }: { projects: Project[]; onSubmit: (input: any) => Promise<void>; }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id || "");

  const submit = () => {
    if (!name.trim() || !projectId) return;
    onSubmit({ name: name.trim(), description: description.trim() || null, project_id: projectId });
  };

  return (
    <>
      <FormField label="Project">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="form-input">
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </FormField>
      <FormField label="Name">
        <input value={name} onChange={e => setName(e.target.value)} autoFocus className="form-input"
          placeholder="e.g. Acme Corp — Q2 Campaign" />
      </FormField>
      <FormField label="Description (optional)">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="form-input"
          placeholder="What clients see at the top of the workspace." />
      </FormField>
      <FormActions onSubmit={submit} />
    </>
  );
}

function ShareControls({ workspace, onEnable, onDisable }: {
  workspace: Workspace; onEnable: () => Promise<void>; onDisable: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [appUrl, setAppUrl] = useState("");

  React.useEffect(() => {
    setAppUrl(typeof window !== "undefined" ? window.location.origin : "");
  }, []);

  if (!workspace.is_public || !workspace.share_token) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-soft">Private — only org members can see.</span>
        <button onClick={onEnable}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-primary rounded">
          <LinkIcon size={12} /> Enable share link
        </button>
      </div>
    );
  }

  const url = `${appUrl}/w/${workspace.share_token}`;
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded">
        <Globe size={10} /> PUBLIC
      </span>
      <input readOnly value={url} className="flex-1 text-xs font-mono px-2 py-1 border border-line rounded bg-bg" />
      <button onClick={copy} className="px-2 py-1 text-xs border border-line rounded bg-white hover:bg-bg">
        {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
      </button>
      <button onClick={onEnable} title="Rotate token"
        className="px-2 py-1 text-xs border border-line rounded bg-white hover:bg-bg text-soft">
        Rotate
      </button>
      <button onClick={onDisable}
        className="px-2 py-1 text-xs border border-red-200 rounded bg-white hover:bg-red-50 text-red-600 font-medium">
        Revoke
      </button>
    </div>
  );
}

// ===========================================================
// USERS
// ===========================================================
function UsersTab({
  users, setUsers, departments, teams, teamMembers, currentUserId, canManageSuperAdmin,
}: {
  users: AdminUser[];
  setUsers: React.Dispatch<React.SetStateAction<AdminUser[]>>;
  departments: Department[];
  teams: Team[];
  teamMembers: TeamMember[];
  currentUserId: string;
  canManageSuperAdmin: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [profileUser, setProfileUser] = useState<AdminUser | null>(null);

  const updateUser = async (id: string, patch: { role?: UserRole; department_id?: string | null; job_title?: string | null }) => {
    const r = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      alert(j?.error || "Update failed");
      return;
    }
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u));
  };

  const ROLE_LABELS: Record<string, string> = {
    super_admin: "Super Admin", admin: "Admin", dept_head: "Dept Head", team_lead: "Team Lead", member: "Member",
  };
  const ROLE_COLORS: Record<string, string> = {
    super_admin: "bg-violet-50 text-violet-700", admin: "bg-red-50 text-red-700", dept_head: "bg-amber-50 text-amber-700",
    team_lead: "bg-blue-50 text-blue-700", member: "bg-slate-50 text-slate-600",
  };

  return (
    <SectionShell
      title="People"
      desc="Create and manage team members. Assign roles and departments."
      action={
        <NewBtn onClick={() => setShowCreate(true)} label="Create user" icon={<UserPlus size={13} strokeWidth={2.5} />} />
      }>
      <div className="bg-white border border-line rounded overflow-hidden">
        <div className="grid grid-cols-[2fr_2fr_1.2fr_1.5fr_1fr_48px] text-[11px] font-semibold text-soft uppercase tracking-wide px-4 py-2.5 bg-bg border-b border-line">
          <div>Name</div><div>Email</div><div>Role</div><div>Department</div><div>Job Title</div><div />
        </div>
        {users.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-mute italic">No users yet. Create the first one.</div>
        )}
        {users.map(u => {
          const dept = departments.find(d => d.id === u.department_id);
          return (
            <div key={u.id} className="grid grid-cols-[2fr_2fr_1.2fr_1.5fr_1fr_48px] items-center px-4 py-3 border-b border-line last:border-0 hover:bg-bg group">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                  {(u.name || u.email)[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink truncate">
                    {u.name || u.email.split("@")[0]}
                    {u.id === currentUserId && <span className="ml-1.5 text-[10px] font-semibold text-mute">(you)</span>}
                  </div>
                  {u.job_title && <div className="text-[11px] text-soft truncate">{u.job_title}</div>}
                </div>
              </div>
              <div className="text-xs text-soft truncate pr-3">{u.email}</div>
              <div>
                <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${ROLE_COLORS[u.role]}`}>
                  {ROLE_LABELS[u.role]}
                </span>
              </div>
              <div>
                {dept ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-soft">
                    <span className="w-2 h-2 rounded-full" style={{ background: dept.color }} />
                    {dept.name}
                  </span>
                ) : <span className="text-xs text-mute">—</span>}
              </div>
              <div className="text-xs text-soft truncate">{u.job_title || "—"}</div>
              <div className="flex justify-end">
                <button
                  onClick={() => setProfileUser(u)}
                  className="p-1.5 text-mute hover:text-primary rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  title="View profile">
                  <Eye size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <Modal title="Create new user" onClose={() => setShowCreate(false)}>
          <UserCreateForm
            departments={departments}
            teams={teams}
            canManageSuperAdmin={canManageSuperAdmin}
            onSubmit={async (input) => {
              const r = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              const j = await r.json();
              if (!r.ok) { alert(j?.error || "Create failed"); return; }
              setUsers(prev => [...prev, j.user]);
              setShowCreate(false);
            }}
          />
        </Modal>
      )}

      {profileUser && (
        <UserProfileModal
          user={profileUser}
          departments={departments}
          teams={teams}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          canManageSuperAdmin={canManageSuperAdmin}
          onUpdate={async (patch) => {
            await updateUser(profileUser.id, patch);
            setProfileUser(prev => prev ? { ...prev, ...patch } : null);
          }}
          onClose={() => setProfileUser(null)}
        />
      )}
    </SectionShell>
  );
}

function UserCreateForm({ departments, teams, canManageSuperAdmin, onSubmit }: {
  departments: Department[];
  teams: Team[];
  canManageSuperAdmin: boolean;
  onSubmit: (input: any) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [deptId, setDeptId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);

  // Teams filtered by selected department (if any). Teams with no department always shown.
  const visibleTeams = deptId
    ? teams.filter((t) => !t.department_id || t.department_id === deptId)
    : teams;

  const submit = async () => {
    if (!name.trim() || !email.trim() || password.length < 6) return;
    setSaving(true);
    await onSubmit({
      name: name.trim(),
      email: email.trim(),
      password,
      role,
      department_id: deptId || null,
      team_id: teamId || null,
      job_title: jobTitle.trim() || null,
    });
    setSaving(false);
  };

  return (
    <>
      <div className="flex gap-3">
        <FormField label="Full name">
          <input value={name} onChange={e => setName(e.target.value)} autoFocus
            className="form-input" placeholder="Jane Smith" />
        </FormField>
        <FormField label="Job title (optional)">
          <input value={jobTitle} onChange={e => setJobTitle(e.target.value)}
            className="form-input" placeholder="Senior Designer" />
        </FormField>
      </div>
      <FormField label="Email address">
        <div className="relative">
          <Mail size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
          <input value={email} onChange={e => setEmail(e.target.value)} type="email"
            className="form-input pl-7" placeholder="jane@company.com" />
        </div>
      </FormField>
      <FormField label="Password (min 6 chars)">
        <div className="relative">
          <Key size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
          <input value={password} onChange={e => setPassword(e.target.value)}
            type={showPass ? "text" : "password"}
            className="form-input pl-7 pr-16" placeholder="••••••••" />
          <button type="button" onClick={() => setShowPass(s => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-primary">
            {showPass ? "Hide" : "Show"}
          </button>
        </div>
      </FormField>
      <div className="flex gap-3">
        <FormField label="Role">
          <select value={role} onChange={e => setRole(e.target.value as UserRole)} className="form-input">
            <option value="member">Member</option>
            <option value="team_lead">Team Lead</option>
            <option value="dept_head">Dept Head</option>
            <option value="admin">Admin</option>
            {canManageSuperAdmin && <option value="super_admin">Super Admin</option>}
          </select>
        </FormField>
        <FormField label="Department">
          <select value={deptId} onChange={e => { setDeptId(e.target.value); setTeamId(""); }} className="form-input">
            <option value="">— None</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FormField>
        <FormField label="Team (optional)">
          <select value={teamId} onChange={e => setTeamId(e.target.value)} className="form-input">
            <option value="">— None</option>
            {visibleTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </FormField>
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={submit} disabled={saving || !name.trim() || !email.trim() || password.length < 6}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded shadow-sm disabled:opacity-50">
          <UserPlus size={13} strokeWidth={2.5} />
          {saving ? "Creating…" : "Create user"}
        </button>
      </div>
    </>
  );
}

function UserProfileModal({ user, departments, teams, teamMembers, currentUserId, canManageSuperAdmin, onUpdate, onClose }: {
  user: AdminUser;
  departments: Department[];
  teams: Team[];
  teamMembers: TeamMember[];
  currentUserId: string;
  canManageSuperAdmin: boolean;
  onUpdate: (patch: any) => Promise<void>;
  onClose: () => void;
}) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [deptId, setDeptId] = useState(user.department_id || "");
  const [jobTitle, setJobTitle] = useState(user.job_title || "");
  const [saving, setSaving] = useState(false);

  const dept = departments.find(d => d.id === user.department_id);
  const userTeams = teamMembers
    .filter(m => m.user_id === user.id)
    .map(m => ({ ...teams.find(t => t.id === m.team_id)!, memberRole: m.role }))
    .filter(Boolean);

  const ROLE_LABELS: Record<string, string> = {
    super_admin: "Super Admin", admin: "Admin", dept_head: "Dept Head", team_lead: "Team Lead", member: "Member",
  };
  const ROLE_COLORS: Record<string, string> = {
    super_admin: "bg-violet-50 text-violet-700 border-violet-200",
    admin: "bg-red-50 text-red-700 border-red-200",
    dept_head: "bg-amber-50 text-amber-700 border-amber-200",
    team_lead: "bg-blue-50 text-blue-700 border-blue-200",
    member: "bg-slate-50 text-slate-600 border-slate-200",
  };

  const save = async () => {
    setSaving(true);
    await onUpdate({ role, department_id: deptId || null, job_title: jobTitle.trim() || null });
    setSaving(false);
  };

  return (
    <div onClick={onClose}
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center p-5">
      <div onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-[560px] overflow-hidden shadow-2xl">

        {/* Header / identity */}
        <div className="px-6 py-5 bg-gradient-to-br from-primary/5 to-violet-50 border-b border-line">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-white text-xl font-bold flex items-center justify-center flex-shrink-0">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold text-ink">{user.name || user.email.split("@")[0]}</div>
              {user.job_title && (
                <div className="text-sm text-soft mt-0.5 flex items-center gap-1.5">
                  <Briefcase size={12} className="text-mute" />
                  {user.job_title}
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-soft">
                <Mail size={11} className="text-mute" />
                {user.email}
                {user.id === currentUserId && (
                  <span className="ml-1 px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] font-semibold rounded">You</span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 text-soft hover:text-ink">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          {/* Left: edit fields */}
          <div className="flex flex-col gap-3">
            <div className="text-[11px] font-semibold text-mute uppercase tracking-wide">Edit profile</div>
            <FormField label="Job title">
              <input value={jobTitle} onChange={e => setJobTitle(e.target.value)}
                className="form-input" placeholder="e.g. Senior Engineer" />
            </FormField>
            <FormField label="Role">
              <select value={role} onChange={e => setRole(e.target.value as UserRole)} className="form-input">
                {!canManageSuperAdmin && role === "super_admin" && (
                  <option value="super_admin" disabled>Super Admin</option>
                )}
                <option value="member">Member</option>
                <option value="team_lead">Team Lead</option>
                <option value="dept_head">Dept Head</option>
                <option value="admin">Admin</option>
                {canManageSuperAdmin && <option value="super_admin">Super Admin</option>}
              </select>
            </FormField>
            <FormField label="Department">
              <select value={deptId} onChange={e => setDeptId(e.target.value)} className="form-input">
                <option value="">— None</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </FormField>
            <button onClick={save} disabled={saving}
              className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded shadow-sm disabled:opacity-50">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>

          {/* Right: hierarchy summary */}
          <div className="flex flex-col gap-3">
            <div className="text-[11px] font-semibold text-mute uppercase tracking-wide">Position</div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 p-2.5 bg-bg border border-line rounded-lg">
                <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${ROLE_COLORS[user.role]}`}>
                  {ROLE_LABELS[user.role]}
                </span>
                <span className="text-xs text-soft">system role</span>
              </div>

              {dept && (
                <div className="flex items-center gap-2 p-2.5 bg-bg border border-line rounded-lg">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: dept.color }} />
                  <span className="text-xs font-semibold text-ink">{dept.name}</span>
                  <span className="text-xs text-soft ml-auto">department</span>
                </div>
              )}

              {userTeams.length > 0 && (
                <div className="mt-1">
                  <div className="text-[10.5px] text-mute font-semibold uppercase mb-1.5">Teams</div>
                  {userTeams.map(t => (
                    <div key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 border border-line rounded-lg bg-white mb-1.5 text-xs">
                      <UsersIcon size={11} className="text-mute" />
                      <span className="font-medium text-ink flex-1">{t.name}</span>
                      <span className="text-[10px] font-semibold text-mute uppercase">{t.memberRole}</span>
                    </div>
                  ))}
                </div>
              )}

              {userTeams.length === 0 && !dept && (
                <div className="text-xs text-mute italic p-3 bg-bg rounded-lg border border-line">
                  Not yet assigned to a department or team.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================
// ORG CHART
// ===========================================================
function OrgChartTab({ users, departments, teams, teamMembers }: {
  users: AdminUser[];
  departments: Department[];
  teams: Team[];
  teamMembers: TeamMember[];
}) {
  const [profileUser, setProfileUser] = useState<AdminUser | null>(null);

  const ROLE_COLORS: Record<string, string> = {
    super_admin: "bg-violet-50 text-violet-700 border-violet-200",
    admin: "bg-red-50 text-red-700 border-red-200",
    dept_head: "bg-amber-50 text-amber-700 border-amber-200",
    team_lead: "bg-blue-50 text-blue-700 border-blue-200",
    member: "bg-slate-50 text-slate-600 border-slate-200",
  };
  const ROLE_LABELS: Record<string, string> = {
    super_admin: "Super Admin", admin: "Admin", dept_head: "Dept Head", team_lead: "Team Lead", member: "Member",
  };

  const unassigned = users.filter(u =>
    !u.department_id && !teamMembers.some(m => m.user_id === u.id)
  );

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-base font-bold text-ink">Company Hierarchy</h2>
        <p className="text-xs text-soft mt-0.5">Organisation structure — departments, teams, and people.</p>
      </div>

      <div className="flex flex-col gap-6">
        {departments.map(dept => {
          const deptHead = users.find(u => u.id === dept.head_user_id);
          const deptTeams = teams.filter(t => t.department_id === dept.id);
          const deptDirectMembers = users.filter(u =>
            u.department_id === dept.id && !teamMembers.some(m => m.user_id === u.id)
          );

          return (
            <div key={dept.id} className="bg-white border border-line rounded-xl overflow-hidden">
              {/* Dept header */}
              <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line"
                style={{ borderLeftWidth: 4, borderLeftColor: dept.color }}>
                <Building2 size={16} className="text-mute" />
                <div>
                  <div className="text-sm font-bold text-ink">{dept.name}</div>
                  {dept.description && <div className="text-xs text-soft">{dept.description}</div>}
                </div>
                {deptHead && (
                  <button
                    onClick={() => setProfileUser(deptHead)}
                    className="ml-auto flex items-center gap-2 px-2.5 py-1 border border-line rounded-lg text-xs text-soft hover:bg-bg">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[9px] font-bold flex items-center justify-center">
                      {(deptHead.name || deptHead.email)[0].toUpperCase()}
                    </div>
                    Head: {deptHead.name || deptHead.email.split("@")[0]}
                  </button>
                )}
              </div>

              <div className="p-4 flex flex-col gap-3">
                {/* Teams */}
                {deptTeams.map(team => {
                  const lead = users.find(u => u.id === team.lead_id);
                  const members = teamMembers
                    .filter(m => m.team_id === team.id)
                    .map(m => ({ user: users.find(u => u.id === m.user_id)!, memberRole: m.role }))
                    .filter(m => m.user);

                  return (
                    <div key={team.id} className="ml-4 bg-bg border border-line rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-white">
                        <UsersIcon size={13} className="text-mute" />
                        <span className="text-sm font-semibold text-ink">{team.name}</span>
                        {lead && (
                          <button onClick={() => setProfileUser(lead)}
                            className="ml-auto flex items-center gap-1.5 text-xs text-soft hover:text-ink">
                            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[8px] font-bold flex items-center justify-center">
                              {(lead.name || lead.email)[0].toUpperCase()}
                            </div>
                            Lead: {lead.name || lead.email.split("@")[0]}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 p-3">
                        {members.length === 0 && (
                          <span className="text-[11px] text-mute italic">No members</span>
                        )}
                        {members.map(({ user: u, memberRole }) => (
                          <button key={u.id} onClick={() => setProfileUser(u)}
                            className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-line rounded-lg hover:border-primary/40 hover:shadow-sm transition-all text-left">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                              {(u.name || u.email)[0].toUpperCase()}
                            </div>
                            <div>
                              <div className="text-[12px] font-semibold text-ink leading-tight">
                                {u.name || u.email.split("@")[0]}
                              </div>
                              <div className="text-[10px] text-soft leading-tight">
                                {u.job_title || ROLE_LABELS[u.role]}
                              </div>
                            </div>
                            {memberRole === "lead" && (
                              <span className="ml-1 text-[9px] font-bold text-amber-600 bg-amber-50 px-1 rounded">LEAD</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Department direct members (no team) */}
                {deptDirectMembers.length > 0 && (
                  <div className="ml-4">
                    <div className="text-[10.5px] font-semibold text-mute uppercase mb-2">Direct (no team)</div>
                    <div className="flex flex-wrap gap-2">
                      {deptDirectMembers.map(u => (
                        <button key={u.id} onClick={() => setProfileUser(u)}
                          className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-line rounded-lg hover:border-primary/40 hover:shadow-sm transition-all text-left">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                            {(u.name || u.email)[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="text-[12px] font-semibold text-ink leading-tight">
                              {u.name || u.email.split("@")[0]}
                            </div>
                            <div className="text-[10px] text-soft leading-tight">
                              {u.job_title || ROLE_LABELS[u.role]}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {deptTeams.length === 0 && deptDirectMembers.length === 0 && (
                  <div className="ml-4 text-xs text-mute italic">No teams or members yet.</div>
                )}
              </div>
            </div>
          );
        })}

        {/* Cross-dept teams */}
        {teams.filter(t => !t.department_id).length > 0 && (
          <div className="bg-white border border-line rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line border-l-4 border-l-slate-400">
              <UsersIcon size={16} className="text-mute" />
              <div>
                <div className="text-sm font-bold text-ink">Cross-department Teams</div>
                <div className="text-xs text-soft">Teams that span multiple departments</div>
              </div>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {teams.filter(t => !t.department_id).map(team => {
                const lead = users.find(u => u.id === team.lead_id);
                const members = teamMembers
                  .filter(m => m.team_id === team.id)
                  .map(m => ({ user: users.find(u => u.id === m.user_id)!, memberRole: m.role }))
                  .filter(m => m.user);
                return (
                  <div key={team.id} className="bg-bg border border-line rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-white">
                      <span className="text-sm font-semibold text-ink">{team.name}</span>
                      {lead && (
                        <button onClick={() => setProfileUser(lead)}
                          className="ml-auto flex items-center gap-1.5 text-xs text-soft hover:text-ink">
                          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[8px] font-bold flex items-center justify-center">
                            {(lead.name || lead.email)[0].toUpperCase()}
                          </div>
                          Lead: {lead.name || lead.email.split("@")[0]}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 p-3">
                      {members.map(({ user: u }) => (
                        <button key={u.id} onClick={() => setProfileUser(u)}
                          className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-line rounded-lg hover:border-primary/40 hover:shadow-sm text-left">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white text-[10px] font-bold flex items-center justify-center">
                            {(u.name || u.email)[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="text-[12px] font-semibold text-ink">{u.name || u.email.split("@")[0]}</div>
                            <div className="text-[10px] text-soft">{u.job_title || ROLE_LABELS[u.role]}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Unassigned */}
        {unassigned.length > 0 && (
          <div className="bg-white border border-dashed border-line rounded-xl p-5">
            <div className="text-[11px] font-semibold text-mute uppercase tracking-wide mb-3">
              Not yet assigned
            </div>
            <div className="flex flex-wrap gap-2">
              {unassigned.map(u => (
                <button key={u.id} onClick={() => setProfileUser(u)}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-bg border border-line rounded-lg hover:border-primary/40 text-left">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {(u.name || u.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold text-ink">{u.name || u.email.split("@")[0]}</div>
                    <div className="text-[10px] text-soft">{u.job_title || ROLE_LABELS[u.role]}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {departments.length === 0 && (
          <div className="py-16 text-center text-soft text-sm">
            No departments yet — create some in the Departments tab first.
          </div>
        )}
      </div>

      {profileUser && (
        <UserProfileModal
          user={profileUser}
          departments={departments}
          teams={teams}
          teamMembers={teamMembers}
          currentUserId=""
          canManageSuperAdmin={false}
          onUpdate={async () => {}}
          onClose={() => setProfileUser(null)}
        />
      )}
    </div>
  );
}

// ===========================================================
// PRIMITIVES
// ===========================================================
function SectionShell({ title, desc, action, children }: any) {
  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          {desc && <p className="text-xs text-soft mt-0.5">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function NewBtn({ onClick, label, icon }: { onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded">
      {icon ?? <Plus size={13} strokeWidth={2.5} />}
      {label}
    </button>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-line rounded overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-bg border-b border-line">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left text-[11px] font-semibold text-soft uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-xs text-mute italic">{text}</td>
    </tr>
  );
}

function Modal({ title, onClose, children }: any) {
  return (
    <div onClick={onClose}
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-5"
      style={{ animation: "fadeIn 0.1s ease" }}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white/95 backdrop-blur-xl rounded-2xl w-full max-w-[520px] overflow-hidden animate-modalIn"
        style={{ boxShadow: "0 24px 64px -16px rgba(15,23,42,0.2), 0 8px 24px -8px rgba(15,23,42,0.1), 0 0 0 1px rgba(255,255,255,0.6) inset" }}>
        <div className="flex justify-between items-center px-5 py-3.5 border-b border-line/50 bg-gradient-to-r from-[#FAFBFC] to-white">
          <span className="text-sm font-semibold text-ink">{title}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg text-soft hover:text-ink hover:bg-bg transition-all"><X size={15} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex-1 min-w-0">
      <label className="block text-[10.5px] font-bold text-mute/70 uppercase tracking-widest mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function FormActions({ onSubmit, submitLabel }: { onSubmit: () => void; submitLabel?: string }) {
  return (
    <div className="flex gap-2.5 justify-end mt-3 pt-3 border-t border-line/40">
      <button onClick={onSubmit}
        className="px-5 py-2.5 bg-brand-grad text-white text-xs font-bold rounded-xl shadow-pop hover:shadow-neon hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200">
        {submitLabel ?? "Save"}
      </button>
    </div>
  );
}

// ===========================================================
// DELETE LOG
// ===========================================================
function DeleteLogTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/delete-log")
      .then((r) => r.json())
      .then((d) => { setEntries(d.entries || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleRestore = async (entryId: string) => {
    setRestoring(entryId);
    try {
      const res = await fetch(`/api/admin/delete-log/${entryId}`, { method: "POST" });
      if (res.ok) {
        setEntries((prev) =>
          prev.map((e) => e.id === entryId ? { ...e, restored_at: new Date().toISOString() } : e)
        );
      }
    } catch {}
    setRestoring(null);
  };

  const handleSaveComment = async (entryId: string) => {
    await fetch(`/api/admin/delete-log/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_comment: commentText }),
    });
    setEntries((prev) =>
      prev.map((e) => e.id === entryId ? { ...e, admin_comment: commentText } : e)
    );
    setEditingComment(null);
    setCommentText("");
  };

  const fmtDate = (d: string) => {
    if (!d) return "—";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Delete Log</h2>
          <p className="text-sm text-soft mt-0.5">Audit trail of all deleted cards. Restore or leave comments.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-mute font-mono bg-bg px-3 py-1.5 rounded-lg border border-line">
          <Trash2 size={12} />
          {entries.length} entries
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white border border-line/60 rounded-xl p-10 text-center">
          <div className="inline-flex w-12 h-12 rounded-xl bg-emerald-50 items-center justify-center mb-3">
            <Check size={20} className="text-emerald-600" />
          </div>
          <div className="text-sm font-semibold text-ink">No deleted cards</div>
          <div className="text-xs text-soft mt-1">All cards are safe and sound.</div>
        </div>
      ) : (
        <div className="bg-white border border-line/60 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_140px] gap-3 px-4 py-2.5 border-b border-line/60 text-[10px] font-bold text-mute uppercase tracking-widest bg-bg/50">
            <div>Card</div>
            <div>Deleted by</div>
            <div>Deleted at</div>
            <div>Status</div>
            <div>Actions</div>
          </div>

          {entries.map((entry: any) => {
            const snap = entry.card_snapshot || {};
            const isRestored = !!entry.restored_at;
            const isEditing = editingComment === entry.id;

            return (
              <div key={entry.id} className={`border-b border-line/30 last:border-b-0 ${isRestored ? "bg-emerald-50/30" : ""}`}>
                {/* Main row */}
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_140px] gap-3 px-4 py-3 items-center">
                  {/* Card info */}
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-ink truncate">{snap.title || "Untitled"}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-mute mt-0.5">
                      <span className="capitalize">{(snap.stage || "").replace(/_/g, " ")}</span>
                      <span>·</span>
                      <span>{snap.progress ?? 0}%</span>
                      <span>·</span>
                      <span className="capitalize">{snap.priority || "medium"} priority</span>
                    </div>
                  </div>

                  {/* Deleted by */}
                  <div className="flex items-center gap-1.5">
                    <div className="w-[20px] h-[20px] rounded-full bg-gradient-to-br from-red-400 to-red-600 text-white text-[8px] font-bold flex items-center justify-center">
                      {(entry.deleted_by_name || "?")[0].toUpperCase()}
                    </div>
                    <span className="text-[11px] text-soft font-medium truncate">{entry.deleted_by_name || "Unknown"}</span>
                  </div>

                  {/* Deleted at */}
                  <div className="flex items-center gap-1 text-[11px] text-mute font-mono">
                    <Clock size={10} />
                    {fmtDate(entry.deleted_at)}
                  </div>

                  {/* Status */}
                  <div>
                    {isRestored ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                        <RotateCcw size={9} /> Restored
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200">
                        <Trash2 size={9} /> Deleted
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    {!isRestored && (
                      <button
                        onClick={() => handleRestore(entry.id)}
                        disabled={restoring === entry.id}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50">
                        <RotateCcw size={10} className={restoring === entry.id ? "animate-spin" : ""} />
                        Restore
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (isEditing) { setEditingComment(null); }
                        else { setEditingComment(entry.id); setCommentText(entry.admin_comment || ""); }
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg border border-line bg-white text-mute text-[10px] font-medium hover:border-primary/30 hover:text-ink transition-colors">
                      <MessageSquare size={10} />
                      {entry.admin_comment ? "Edit" : "Comment"}
                    </button>
                  </div>
                </div>

                {/* Admin comment display / edit */}
                {(entry.admin_comment && !isEditing) && (
                  <div className="px-4 pb-3 -mt-1">
                    <div className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                      <MessageSquare size={11} className="text-violet-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-[9px] font-bold text-violet-600 uppercase tracking-wider mb-0.5">Admin Note</div>
                        <div className="text-[11px] text-violet-800 leading-relaxed">{entry.admin_comment}</div>
                      </div>
                    </div>
                  </div>
                )}

                {isEditing && (
                  <div className="px-4 pb-3 -mt-1">
                    <div className="bg-bg/60 border border-line/60 rounded-lg p-3">
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        rows={2}
                        placeholder="Leave an admin comment about this deletion..."
                        className="w-full px-3 py-2 border border-line rounded-lg bg-white text-[12px] text-ink resize-none focus:border-primary/40 focus:outline-none transition-colors"
                        autoFocus
                      />
                      <div className="flex gap-2 justify-end mt-2">
                        <button
                          onClick={() => setEditingComment(null)}
                          className="px-3 py-1 rounded-lg border border-line text-[11px] font-medium text-mute hover:text-ink transition-colors">
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveComment(entry.id)}
                          className="px-3 py-1 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-primary/90 transition-colors">
                          Save Comment
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
