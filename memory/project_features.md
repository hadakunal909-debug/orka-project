---
name: Stagework feature roadmap and decisions
description: Key architectural decisions and features built into the PM tool
type: project
---

Major feature additions completed 2026-05-09:

- **Teams removed as top-level nav** — Teams are now sub-entities of Projects only; sidebar shows Departments → Projects with member counts. Teams still exist in DB/schema.

- **Messages table added** — Was missing from schema. Migration 002 creates it with E2E flag, RLS, indexes.

- **E2E encrypted DMs** — ECDH P-256 + AES-GCM via Web Crypto API. Public keys stored in users.e2e_public_key (JWK). Private keys in localStorage. lib/e2e-crypto.ts handles key gen, encrypt, decrypt.

- **User profile card** — Clicking any user avatar/name in Chat or People view opens a modal showing: photo, name, job title, department (color), role, online status (last_seen_at < 5 min = online).

- **People & Org view** — Org hierarchy view: Departments → Teams → Members. Shows reporting structure, online presence, member counts. Accessible via "People & Org" nav item.

- **Feedback routing** — feedback_log.assigned_to_id routes feedback to someone. Status: open → pending_response → responded → resolved. "My Assignments" nav item shows inbox. Assignee writes response; original reviewer resolves.

- **User profile fields** — users table extended with: job_title, manager_id, last_seen_at, e2e_public_key. PATCH /api/users/[id] allows self-update.

**Why:** User requested these as a cohesive set. Core issue was messages table missing (DMs broken), plus request to match MS Teams-like UX (hierarchy, profiles, E2E chat).

**How to apply:** When touching chat, feedback, or user profile code, check these fields exist in DB (run migration 002 if not).

---

Realtime data sync added 2026-05-19:

- **Postgres realtime broadcasts** for `cards`, `feedback_log`, `projects` — migration `supabase/migrations/20260519_realtime_publications.sql` adds these tables to the `supabase_realtime` publication. Must be run in Supabase SQL Editor for events to flow.
- **Client subscription** in DashboardClient: a second realtime channel `org-${profile.org_id}-data` streams INSERT/UPDATE/DELETE events for the three tables and merges them into local cards/feedback/projects/myAssignments state. Filters by `org_id` defensively (realtime broadcasts don't respect RLS by default). Soft-deletes (`deleted_at` set via UPDATE) are converted to removals from local lists.
- **Manual refresh button** in the page header — does `window.location.reload()`. Belt-and-suspenders alongside realtime.

**Why:** User wanted multi-user changes to appear without manual refresh, matching how chat already worked.

**How to apply:** When adding a new table that needs live sync, (1) add it to the publication via migration, (2) add a `.on("postgres_changes" ...)` handler in the `[realtime/data]` useEffect.
