import type { Card, Department, FeedbackEntry, Project, Team, TeamMember, User } from "./types";

type AccessProfile = Pick<User, "id" | "role" | "department_id">;

export function isAdmin(profile: AccessProfile) {
  return profile.role === "admin" || profile.role === "super_admin";
}

export function isSuperAdmin(profile: AccessProfile) {
  return profile.role === "super_admin";
}

export function getAccessibleProjectIds(input: {
  profile: AccessProfile;
  departments: Department[];
  teams: Team[];
  teamMembers: TeamMember[];
  projects: Project[];
  projectAccess?: { project_id: string; user_id: string }[];
}) {
  const { profile, departments, teams, teamMembers, projects, projectAccess = [] } = input;
  if (isAdmin(profile)) return new Set(projects.map((p) => p.id));

  const headedDeptIds = new Set(
    departments
      .filter((d) => d.head_user_id === profile.id || d.id === profile.department_id)
      .map((d) => d.id)
  );
  const userTeamIds = new Set(
    teamMembers.filter((m) => m.user_id === profile.id).map((m) => m.team_id)
  );
  teams
    .filter((t) => t.lead_id === profile.id || (t.department_id && headedDeptIds.has(t.department_id)))
    .forEach((t) => userTeamIds.add(t.id));

  return new Set(
    projects
      .filter((p) => {
        if (p.visibility === "org") return true;
        if (p.lead_id === profile.id) return true;
        if (projectAccess.some((a) => a.project_id === p.id && a.user_id === profile.id)) return true;
        if (p.team_id && userTeamIds.has(p.team_id)) return true;
        if (p.department_id && headedDeptIds.has(p.department_id)) return true;
        return false;
      })
      .map((p) => p.id)
  );
}

export function filterAccessibleCards(input: {
  profile: AccessProfile;
  cards: Card[];
  accessibleProjectIds: Set<string>;
}) {
  const { profile, cards, accessibleProjectIds } = input;
  return cards.filter((card) => {
    if (card.deleted_at) return false;
    const hasProjectAccess = accessibleProjectIds.has(card.project_id);
    const hasCardAccess =
      card.assignee_id === profile.id ||
      card.hidden_by === profile.id ||
      (Array.isArray(card.visible_to) && card.visible_to.includes(profile.id));

    if (profile.role === "member") return hasCardAccess;
    if (!hasProjectAccess && !hasCardAccess && !isAdmin(profile)) return false;
    if (!card.is_hidden) return true;
    return isAdmin(profile) || hasCardAccess;
  });
}

export function filterAccessibleFeedback(feedback: FeedbackEntry[], accessibleCardIds: Set<string>, profile: AccessProfile) {
  if (isAdmin(profile)) return feedback.filter((f) => accessibleCardIds.has(f.card_id));
  return feedback.filter((f) =>
    accessibleCardIds.has(f.card_id) &&
    (f.assigned_to_id === profile.id || f.reviewer_id === profile.id)
  );
}
