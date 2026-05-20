# Stagework / Orka Project — Engineering Handoff

> **Audience:** The team taking over development, deployment, and operations of this app.
> **Status as of handoff:** 2026-05-20. Production-ready for internal pilot. Not yet wired to a public domain.
> **Branding note:** Internal codename is **Stagework**. User-facing brand is **Orka Project** (part of the Orka suite). The repo, package name, and most code references still use "stagework".

---

## 1. Executive Summary

Orka Project is a **project & program management web app** for Google Workspace organizations. It implements the **Michelin Method** — a staged workflow (On Order → Prep Table → Front Burner → Back Burner → Pass-QA → Served) with structured feedback at 10/30/50/70/90% checkpoints across 8 lenses (F·E·E·D·B·A·C·K).

It is **multi-tenant by Google Workspace domain**: each domain becomes an `organization`, and all data is scoped by `org_id` with Postgres Row-Level Security (RLS).

**Core capabilities shipped:**
- Google OAuth sign-in restricted to a single Workspace domain (`ALLOWED_GOOGLE_DOMAIN`)
- Hierarchical org model: Departments → Teams → Projects → Cards → Feedback
- Public-shareable client Workspaces (read-only via share token)
- E2E-encrypted DMs (ECDH P-256 + AES-GCM, browser-side)
- Project messages / chat channels
- Realtime sync for cards, feedback, projects (Supabase Realtime)
- Google Calendar event creation on card due dates
- Daily checkpoint-nudge emails + weekly digest (Vercel cron + Gmail API)
- Admin console for users, departments, teams, projects, workspaces
- Soft-delete with restore log for cards
- Role-based access (super_admin / admin / dept_head / team_lead / member)
- Gemini AI card-draft endpoint (`@google/genai`)

---

## 2. Tech Stack

| Layer            | Technology |
|------------------|------------|
| Framework        | Next.js 14.2 (App Router), React 18, TypeScript 5.6 |
| Styling          | Tailwind CSS 3.4, custom design tokens in `tailwind.config.js` |
| UI primitives    | `@base-ui/react`, `lucide-react`, custom components in `components/ui/` |
| Database         | Supabase (Postgres 15) with Row-Level Security |
| Auth             | Supabase Auth + Google OAuth 2.0 (via `googleapis` directly for tokens) |
| File storage     | Supabase Storage (attachments — see migration 005) |
| Realtime         | Supabase Realtime (Postgres logical replication → WebSocket) |
| Email            | Gmail API (sends from the signed-in admin's mailbox) |
| Calendar         | Google Calendar API (per-user events) |
| Cron             | Vercel Cron (`vercel.json`) |
| AI               | Google Gemini via `@google/genai` |
| Validation       | Zod |
| Crypto           | Browser Web Crypto API for E2E; Node `crypto` (AES-256-GCM) for token-at-rest |
| Hosting (intended) | Vercel |
| Misc deps        | `@a2ui/react`, `@a2ui/web_core` (used in parts of the UI) |

---

## 3. Repository Layout

```
stagework/
├── app/                          Next.js App Router
│   ├── page.tsx                  Landing / sign-in page
│   ├── layout.tsx                Root layout, fonts, global CSS
│   ├── globals.css               Tailwind + custom CSS
│   ├── dashboard/page.tsx        Main authenticated UI (delegates to DashboardClient)
│   ├── admin/page.tsx            Admin console (delegates to AdminClient)
│   └── api/                      Route handlers
│       ├── auth/
│       │   ├── google/{signin,callback}/route.ts   Google OAuth flow
│       │   ├── signin/route.ts                     Email/password sign-in
│       │   ├── dev-signin/route.ts                 Dev-only quick-switch (NODE_ENV !== production)
│       │   └── signout/route.ts
│       ├── cards/route.ts                          GET (list w/ access filter) + POST
│       ├── cards/[id]/route.ts                     PATCH, DELETE (soft delete)
│       ├── cards/[id]/{activity,attachments,subtasks}/   Sub-resources
│       ├── feedback/route.ts                       POST + routing
│       ├── feedback/[id]/route.ts                  PATCH (respond/resolve/route)
│       ├── projects/route.ts                       GET, POST
│       ├── projects/[id]/route.ts                  PATCH, DELETE
│       ├── projects/[id]/members/route.ts          Project-level membership
│       ├── departments/[ route.ts | [id]/{route.ts,embeds} ]
│       ├── teams/[ route.ts | [id]/{route.ts,members,embeds} ]
│       ├── users/[id]/route.ts                     Self-profile updates
│       ├── workspaces/{route.ts,[id]/{route.ts,share}}   Client workspaces + share token
│       ├── public/workspace/[token]/route.ts       Public read-only by token (bypasses RLS)
│       ├── messages/{route.ts,unread/route.ts}     Chat + DM endpoints
│       ├── admin/users/{route.ts,[id]/route.ts}    Admin user management
│       ├── admin/delete-log/{route.ts,[id]/route.ts}   Card restore
│       ├── agent/{draft-card,ping}/route.ts        Gemini AI draft
│       ├── dev/{migrate,seed}/route.ts             Dev-only DB helpers
│       └── cron/{checkpoint-nudges,weekly-digest}/route.ts   Vercel cron handlers
├── components/
│   ├── DashboardClient.tsx       ~293 KB — the main authenticated SPA. All views live here.
│   ├── AdminClient.tsx           ~86 KB — admin console UI
│   ├── SignInForm.tsx            Email/password sign-in form
│   └── ui/button.tsx             Single Button primitive (CVA-based)
├── lib/
│   ├── methodology.ts            Stages, checkpoints, lenses, priority constants (SSoT)
│   ├── types.ts                  TypeScript types for every domain entity
│   ├── access.ts                 Server-side access-control helpers (used by SSR + API)
│   ├── card-access.ts            Card-level visibility helpers
│   ├── activity.ts               Card activity-log helpers
│   ├── api-helpers.ts            Shared response helpers
│   ├── encryption.ts             AES-256-GCM for refresh tokens at rest
│   ├── e2e-crypto.ts             Browser ECDH P-256 + AES-GCM for DMs
│   ├── rate-limit.ts             Simple in-memory rate limiter
│   ├── security.ts               CSRF/state helpers
│   ├── supabase-server.ts        createClient() + createAdminClient() (RLS bypass)
│   ├── supabase-browser.ts       Browser Supabase client
│   ├── utils.ts                  cn() + misc
│   └── google/
│       ├── client.ts             OAuth client factory + token refresh
│       ├── calendar.ts           Create/update/delete Calendar events
│       └── gmail.ts              Send email + HTML templates
├── supabase/
│   ├── schema.sql                Authoritative base schema (drop-and-recreate)
│   ├── seed.sql                  Sample data
│   ├── seed_hypothetical.sql     Larger demo seed
│   ├── 004_departments_branding.sql
│   ├── 005_project_members_attachments.sql
│   ├── 006_rls_for_005.sql
│   ├── 007_card_embeds.sql
│   ├── 008_embeds_on_entities.sql
│   ├── 009_fix_rls_recursion.sql
│   ├── 010_enforce_project_visibility.sql
│   ├── add_dm_messages.sql
│   ├── add_messages.sql
│   ├── add_user_fields.sql
│   └── migrations/
│       ├── 002_messages_e2e_feedback_routing.sql
│       ├── 003_feedback_routing_chain.sql
│       ├── 20260517_card_permissions_delete_log.sql
│       ├── 20260517_fix_project_access.sql
│       ├── 20260518_super_admin_role.sql
│       └── 20260519_realtime_publications.sql
├── middleware.ts                 Refreshes Supabase session cookies on every request
├── vercel.json                   Cron schedule
├── next.config.js                Next config
├── tailwind.config.js            Design tokens (brand grad, ink/soft/mute colors, shadows)
├── tsconfig.json
├── package.json
├── .env.example                  Copy to .env.local
└── README.md                     Original 60-min setup guide
```

**Note on legacy folder:** There is a stray `{app,app` directory at the repo root left over from a shell-glob error. It is unused and safe to delete.

---

## 4. Data Model

### 4.1 Core entities

```
organizations (1) ─┬─→ users (n)
                   ├─→ departments (n) ──→ teams (n) ──→ team_members (n)
                   ├─→ projects (n)  ──→ workspaces (n)  ──→ workspace_members / workspace_guests
                   ├─→ cards (n)  ──→ subtasks, attachments, embeds, card_activity
                   ├─→ feedback_log (n)  (with routing_chain JSONB)
                   └─→ messages (n) (channels + E2E DMs)
```

- `organizations.domain` is unique — one per Google Workspace.
- Every domain table has `org_id` and an `org_id`-scoped RLS policy.
- **Stage enum:** `on_order | prep_table | front_burner | back_burner | pass_qa | served`
- **Priority enum:** `high | medium | low`
- **User roles:** `super_admin | admin | dept_head | team_lead | member` (super_admin added in migration `20260518`)
- **Project visibility:** `private | team | org` (added in `010_enforce_project_visibility.sql`)
- **Workspace member roles:** `owner | editor | viewer`

### 4.2 Key tables to be aware of

| Table | Purpose | Notes |
|-------|---------|-------|
| `users` | Auth-linked profile | Holds `google_refresh_token` (AES-GCM encrypted bytea), `e2e_public_key` (JWK) |
| `departments` | Top-level org structure | Has `head_user_id`, `color`, optional logo (migration 004) |
| `teams` | Working groups | Optional `department_id`, has `lead_id` |
| `team_members` | Composite PK `(team_id, user_id)` | role: `lead`/`member` |
| `projects` | Unit of work | Has `team_id`, `department_id`, `lead_id`, `visibility`, integration ids (`drive_folder_id`, `sheet_id`) |
| `project_access` | Per-user grants | Added in `20260517_fix_project_access.sql` — read by `getAccessibleProjectIds` |
| `project_members` | Project-level membership | Migration 005 |
| `workspaces` | Client-facing project view | `is_public` + `share_token` (random 24-byte base64) for public read |
| `workspace_members` / `workspace_guests` | Internal members + tracked external invitees |
| `cards` | Tasks | `stage`, `progress` (0-100), `last_feedback` (10/30/50/70/90), `is_hidden`, `visible_to[]`, `deleted_at` (soft-delete) |
| `subtasks` | Sub-items of cards | Has own progress, assignee, due date |
| `card_activity` | Audit trail per card | Used by activity timeline |
| `card_embeds` / entity embeds | URL/file embeds | Migrations 007, 008 |
| `card_attachments` | File uploads (Supabase Storage) | Migration 005 |
| `feedback_log` | Checkpoint feedback | `checkpoint` ∈ {10,30,50,70,90}, `lens`, plus routing fields (`assigned_to_id`, `response`, `responded_at`, `status`, `routing_chain JSONB`) |
| `delete_log` | Soft-delete audit + restore | Migration `20260517_card_permissions_delete_log.sql` |
| `messages` | Chat (channels + DMs) | DMs use `is_encrypted=true`, content is base64 AES-GCM ciphertext |
| `notification_prefs` | Per-user channel/event prefs | Auto-created on user insert via trigger |
| `notifications` | Outbound queue | Used by cron + future worker |

### 4.3 RLS model

- **Every table has RLS enabled.** Policies use `security definer` helper functions:
  - `current_user_org()`, `current_user_role()`
  - `current_user_is_admin()` (covers both `admin` and `super_admin`)
  - `current_user_is_super_admin()`
  - `current_user_is_dept_head(p_dept_id)`
  - `current_user_leads_team(p_team_id)`
  - `current_user_in_team(p_team_id)`
- **Admin client (`createAdminClient`)** uses the `SUPABASE_SERVICE_ROLE_KEY` and **bypasses RLS**. Used only in: OAuth callback (user provisioning), cron jobs, public workspace endpoint, and dev seed routes. **Never use it in user-facing routes without manually filtering by `org_id`.**
- **Defense in depth:** `lib/access.ts` re-applies access filtering server-side in addition to RLS. This protects against any RLS gap and is the layer that interprets project `visibility` and per-card `is_hidden` / `visible_to[]`.
- **Realtime caveat:** Supabase realtime broadcasts do **not** respect RLS. The client filters defensively by `org_id` in `DashboardClient`. Combined with the SELECT-side RLS on reads, this is acceptable but the new team should not relax the client-side filter.

### 4.4 Triggers

- `cards_updated_at` → bumps `updated_at` on every UPDATE
- `feedback_updates_card` → after INSERT on `feedback_log`, raises `cards.last_feedback` to max(checkpoint)
- `users_create_prefs` → after INSERT on users, inserts a `notification_prefs` row

---

## 5. Authentication & Authorization

### 5.1 Sign-in flows

| Path | When used | Notes |
|------|-----------|-------|
| `/api/auth/google/signin` → `/api/auth/google/callback` | Production sign-in | OAuth 2.0 with `prompt=consent` (forces refresh_token issuance). Verifies `hd` matches `ALLOWED_GOOGLE_DOMAIN`. Provisions user row on first sign-in. Encrypts refresh token before storing. |
| `/api/auth/signin` | Email/password (Supabase Auth) | Used as fallback if Google is not configured. |
| `/api/auth/dev-signin` | Dev mode only (`NODE_ENV !== "production"`) | Quick-switch between seeded users — used only by the local dev UI. **Must be disabled / unreachable in production.** Verify in deployment. |
| `/api/auth/signout` | Sign-out | Clears Supabase session cookies. |

### 5.2 Roles

Stored on `users.role`. Permissions cascade:

- **super_admin** — full visibility across the org (executive view). Can see and edit everything.
- **admin** — full org-wide control (add users, manage departments/teams, see all projects).
- **dept_head** — can manage their department, the teams within it, and the projects under those teams. Set via `departments.head_user_id`.
- **team_lead** — can manage their team and its projects. Set via `teams.lead_id` or `team_members.role = 'lead'`.
- **member** — sees only the projects/cards they are explicitly granted access to (team membership, project_access, project visibility = org, or assignee_id on the card).

`isAdmin()` returns true for both `admin` and `super_admin`. Use `isSuperAdmin()` if you need to gate executive-only views.

### 5.3 Session refresh

`middleware.ts` calls `supabase.auth.getUser()` on every non-static request, which silently refreshes the Supabase session cookie. The matcher excludes static assets.

---

## 6. Environment Variables

From `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL          Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY     Supabase anon key (RLS-bound, safe to expose)
SUPABASE_SERVICE_ROLE_KEY         Supabase service-role key (bypasses RLS — server-only)

GOOGLE_CLIENT_ID                  OAuth client id (Google Cloud Console)
GOOGLE_CLIENT_SECRET              OAuth client secret
ALLOWED_GOOGLE_DOMAIN             e.g. yourcompany.com — restricts which Workspace can sign in

NEXT_PUBLIC_APP_URL               Public origin, e.g. https://stagework.yourcompany.com (used to build OAuth redirect URIs and email links)

TOKEN_ENCRYPTION_KEY              base64-encoded 32 bytes (openssl rand -base64 32)
                                  — encrypts users.google_refresh_token at rest

CRON_SECRET                       Vercel auto-injects this on cron invocations;
                                  used by /api/cron/* to authenticate the caller
```

**Likely additional vars in `.env.local`** (check the file — not in `.env.example`):
- `GEMINI_API_KEY` or similar for `@google/genai` (Gemini AI draft-card endpoint). Confirm and document.

**Rotation checklist:**
- Rotate `TOKEN_ENCRYPTION_KEY` → all stored refresh tokens become unreadable. Force every user to re-sign-in. There is no decrypt-and-re-encrypt migration script yet — write one if you rotate.
- Rotate `GOOGLE_CLIENT_SECRET` → existing refresh tokens continue to work; new sign-ins use the new secret.
- Rotate `SUPABASE_SERVICE_ROLE_KEY` → coordinate with a redeploy.

---

## 7. External Integrations

### 7.1 Google OAuth + APIs

- **Scopes:** `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/gmail.send`. Defined in `lib/google/client.ts`.
- **Refresh tokens** are stored encrypted on `users.google_refresh_token`. `lib/google/client.ts` lazily refreshes the access token when expired.
- **Calendar (`lib/google/calendar.ts`)** — when a card is created/updated with a `due_date`, an event is created on the assignee's primary calendar and the event id is saved to `cards.calendar_event_id`.
- **Gmail (`lib/google/gmail.ts`)** — sends from the actor's mailbox. Used by cron emails. Email templates are HTML strings in this file.
- **Phase-3 stubs (not wired):** Sheets, Drive, Docs. Schema fields exist (`projects.sheet_id`, `projects.drive_folder_id`, `cards.doc_id`, `cards.drive_folder_id`) and OAuth has room for additional scopes.

### 7.2 Gemini AI

- `/api/agent/draft-card` calls Gemini via `@google/genai` to draft card titles/notes from a prompt. `/api/agent/ping` is a health-check.
- **Confirm `GEMINI_API_KEY` (or equivalent) is set.** Lock down with rate limiting (`lib/rate-limit.ts`) before exposing to many users.

### 7.3 Vercel Cron

`vercel.json`:
- `0 14 * * *` (14:00 UTC daily) → `/api/cron/checkpoint-nudges`
- `0 13 * * 1` (Mon 13:00 UTC weekly) → `/api/cron/weekly-digest`

Both endpoints check `Authorization: Bearer ${CRON_SECRET}`.

### 7.4 Supabase Realtime

Migration `20260519_realtime_publications.sql` adds `cards`, `feedback_log`, `projects` to the `supabase_realtime` publication. The client subscribes in `DashboardClient` (`org-${profile.org_id}-data` channel). **Must be re-applied if you ever drop-and-recreate these tables**, otherwise events silently stop firing.

---

## 8. Setup & Deployment

### 8.1 First-time local setup

1. Install: `npm install` (Node 18+ recommended; `@types/node ^22` suggests Node 20+).
2. Copy env: `cp .env.example .env.local` and fill in values.
3. Generate `TOKEN_ENCRYPTION_KEY`: `openssl rand -base64 32`.
4. **Run schema** in Supabase SQL Editor:
   - First: `supabase/schema.sql`
   - Then **in order**: all numbered files under `supabase/` and `supabase/migrations/`. There are two migration locations (legacy root + new `migrations/`) — apply both.
5. (Optional) Run `supabase/seed.sql` (or `seed_hypothetical.sql` for a richer demo) for sample data.
6. **Configure Google OAuth** (Internal app type, see README §1).
7. Add `http://localhost:3000/api/auth/google/callback` to your OAuth client's authorized redirects.
8. `npm run dev` → http://localhost:3000

### 8.2 Production deployment (Vercel — recommended)

1. Push repo to GitHub/GitLab.
2. Import in Vercel → set all env vars from `.env.local` (update `NEXT_PUBLIC_APP_URL` to prod origin).
3. Add prod callback `https://<your-domain>/api/auth/google/callback` to Google OAuth client.
4. Vercel cron is configured by `vercel.json` — no extra setup.
5. Custom domain: Vercel → Settings → Domains. SSL is automatic.

### 8.3 Migration policy

The migration files are split across two folders. Recommended next step for the new team: **consolidate** under `supabase/migrations/` with timestamped names, and adopt the Supabase CLI (`supabase db push`) instead of manual SQL Editor pastes. The `db:types` script (`npm run db:types`) requires `supabase link` to a project first.

---

## 9. Frontend Architecture

### 9.1 Two big client components

- **`components/DashboardClient.tsx`** (~293 KB, single file) — the authenticated SPA. Holds all major views: Board, Projects list, Cards detail, Feedback inbox, Chat, People & Org, My Assignments, etc. **State is local to this component** (`useState`/`useReducer`). Realtime subscriptions live in a `useEffect` block. Hot-reload performance and code review are painful at this size.
- **`components/AdminClient.tsx`** (~86 KB) — admin console UI.

**Recommendation for the new team:** Begin breaking `DashboardClient` into per-view files (one per nav tab). The shape is already there — each view is a sibling component-like block inside the file. Start with the lowest-risk view (e.g., People & Org or Settings) and move outward.

### 9.2 Design system

- Tailwind with custom tokens in `tailwind.config.js` (see colors: `ink`, `soft`, `mute`, `line`, `bg`, `primary`, `brand-grad`; shadows: `subtle`, `soft`, `pop`, `float`).
- Single shared `Button` primitive in `components/ui/button.tsx` (CVA-based). Most UI elements are bespoke inline.
- Branding is "Orka Project" — see `app/page.tsx` for the logo SVG (blue swoosh + dark fin).

### 9.3 Realtime + Manual refresh

Both exist (belt-and-suspenders). The page header has a manual reload button. Soft-deletes (`deleted_at IS NOT NULL` via UPDATE) are converted into local removals.

---

## 10. Security Notes

- **Refresh tokens:** AES-256-GCM at rest. Key from env only — never commit.
- **CSRF / state:** OAuth state token verified in the callback (`lib/security.ts`).
- **Domain restriction:** Enforced twice — Google Internal OAuth + `ALLOWED_GOOGLE_DOMAIN` check in the callback.
- **Public workspace tokens:** 24-byte random URL-safe base64. Not exposed via RLS (the public endpoint uses admin client and filters by token).
- **RLS:** Enabled on every domain table. Helper functions are `security definer` to avoid recursion (migration 009 fixed a recursion bug — read it before changing the helpers).
- **Realtime broadcasts** do not respect RLS; client filters by `org_id`. Do not loosen that filter.
- **Rate limiting:** `lib/rate-limit.ts` is in-memory only — fine for a single Vercel instance but does **not** survive cold starts or scale across instances. Replace with an Upstash/Redis-backed limiter before high-volume traffic.
- **Dev routes** (`/api/dev/*`, `/api/auth/dev-signin`) gate themselves on `NODE_ENV !== 'production'`. Verify after deploying that hitting them returns 404 or similar.

### Known sensitive operations (require admin or service role)
- User provisioning on OAuth callback
- Card restore from `delete_log`
- Public workspace fetch by share token
- Cron senders (read every user in the org)

---

## 11. Operational Runbook

### 11.1 Common issues (from README, still accurate)

- **`refresh_token is null after sign-in`** — Google only issues refresh tokens on first consent. The signin route uses `prompt=consent` so this is mitigated. If a user has revoked access at myaccount.google.com, they'll get a new refresh token on next sign-in.
- **Calendar event not appearing** — User signed in before calendar scope was requested. Have them sign out + back in to re-consent.
- **RLS policy denies query** — User row is missing or has the wrong `org_id`. Check: `SELECT * FROM public.users WHERE id = '<auth-user-id>';`.

### 11.2 Issues observed during development (worth knowing)

- Migration **009_fix_rls_recursion.sql** exists because earlier RLS policies recursed (a policy that queried the same table it protected). If you touch RLS helpers, run a smoke test that hits every table.
- The repo contains stray dev artifacts at the root:
  - `codex-next-3001.{err,out}.log` and `codex-next-3002.{err,out}.log` — old dev-server logs, safe to delete.
  - `{app,app` — empty folder from a shell-glob mistake, safe to delete.
  - `stagework-dashboard-{final,qa}.png` — design references, keep or move to a `/docs` folder.
- `tsconfig.tsbuildinfo` is committed; it's the TS incremental build cache and should be in `.gitignore`.

### 11.3 When something is broken in production

1. **Sign-in broken?** Check Google OAuth redirect URIs match `NEXT_PUBLIC_APP_URL`. Check `ALLOWED_GOOGLE_DOMAIN`. Check Supabase Auth → Providers → Google is enabled with correct credentials.
2. **Cards/feedback not syncing live?** Re-apply `20260519_realtime_publications.sql`. Check Supabase → Database → Replication.
3. **Cron not firing?** Vercel → Project → Settings → Crons. Check the Functions log for the cron endpoints. Verify `CRON_SECRET` env var.
4. **Calendar events not creating?** Check `users.google_refresh_token` is not null; check Google API quotas; check the `calendar.events` scope was granted.
5. **A user can see another org's data?** Stop everything. RLS regression. First check `users.org_id` for the affected user; then run the access-test suite (not yet written — see §13).

---

## 12. Outstanding Work / Known Gaps

### 12.1 Not yet built (referenced in code/schema)
- **Sheets, Drive, Docs integrations** — schema hooks exist (`projects.sheet_id`, `projects.drive_folder_id`, `cards.doc_id`, `cards.drive_folder_id`). README estimates 4–6 days per integration. Pattern to follow: `lib/google/calendar.ts`.
- **Notifications worker** — `notifications` table queues outbound messages; today only the two cron jobs write to it. A background worker that drains the queue (cron-driven or Inngest/Trigger.dev) is needed for in-app notifications, Discord, etc.
- **Discord channel** in `notification_prefs.discord_enabled` / `discord_user_id` — fields exist, sender does not.

### 12.2 Tech debt
- **`DashboardClient.tsx` is a 293 KB single file** — biggest refactor item. Recommend per-view extraction.
- **No automated tests.** No unit, integration, or E2E suite. Highest-leverage first test: an access-control suite that creates two orgs, two users in each, and asserts every API endpoint refuses cross-org reads. This is the single most important safety net for a multi-tenant app.
- **No CI.** No GitHub Actions / Vercel checks beyond build. At minimum: `next build`, `tsc --noEmit`, ESLint.
- **In-memory rate limiter** — replace before scaling.
- **Migrations are split** between `supabase/*.sql` and `supabase/migrations/*.sql`. Consolidate.
- **No `db:types` automation** — `lib/database.types.ts` is referenced by the `db:types` script but the file is not present. Generate and commit so the codebase has typed Supabase queries.
- **No structured logging** — `console.log` only. Add a logger (pino/winston or Vercel-native) before production traffic.

### 12.3 Likely first asks from product
- Better mobile/responsive UI (currently desktop-first).
- A dedicated "Activity" feed across the whole project (per-card activity exists; org-wide does not).
- Granular notification controls.
- Saved views/filters on the board.

---

## 13. Recommended First Two Weeks for the New Team

1. **Day 1–2** — Run the full setup. Sign in with two test Workspace accounts and exercise: create department → team → project → card → checkpoint feedback → routing → restore. Verify Calendar + Gmail integrations end-to-end.
2. **Day 3** — Audit env vars in production (Vercel) and Supabase secrets. Rotate `TOKEN_ENCRYPTION_KEY` only if you can also force re-sign-in (otherwise leave alone).
3. **Day 4–5** — Stand up CI (`next build` + `tsc --noEmit` + ESLint). Generate Supabase types (`npm run db:types`). Add the `.gitignore` entries for `tsconfig.tsbuildinfo` and dev logs.
4. **Week 2** — Write the cross-org RLS smoke test (see 12.2). Then begin the `DashboardClient` extraction with the lowest-risk view.

---

## 14. Contacts & Access You'll Need

> **Action for current owner:** Fill in before handing this doc over.

| Thing | Where | Owner / Account |
|-------|-------|------------------|
| GitHub repo | (URL) | (owner) |
| Vercel project | (URL) | (owner) |
| Supabase project | (URL / project ref) | (owner) |
| Google Cloud project (OAuth) | console.cloud.google.com / (project id) | (Workspace admin) |
| Gemini API key owner | | |
| Domain registrar (for `stagework.yourcompany.com`) | | |
| Slack channel / on-call | | |

---

## 15. Glossary

- **Michelin Method** — The internal methodology this app implements. 6 stages named after restaurant prep stations.
- **Checkpoint** — A percentage milestone (10/30/50/70/90) at which structured feedback is collected before progress continues.
- **Lens** — One of 8 perspectives (F·E·E·D·B·A·C·K = Feasible, Execution, Enhancement, Deliverables, Behaviors, Assumptions, Clarity, Key next step) used when leaving feedback.
- **Card** — A task. Lives inside a project. Moves through stages.
- **Workspace** — A client-facing read-only view of a project, shareable by URL with a token.
- **Routing** — Reassigning a feedback note to someone else to action. Tracked in `feedback_log.routing_chain` (JSONB).
- **E2E** — End-to-end encrypted. Used only for DMs (channel messages are server-readable).

---

*End of handoff. For deeper questions, the original README has the 60-minute setup walkthrough; this document is the engineering reference.*
