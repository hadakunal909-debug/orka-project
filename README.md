# Stagework

Project & program management with the Michelin Method baked in. Built on Next.js 14, Supabase, and Google Workspace.

**What you get:**
- Sign-in restricted to your Google Workspace domain
- 6 stages (On Order → Prep Table → Front Burner → Back Burner → Pass-QA → Served)
- Feedback at 10/30/50/70/90% checkpoints with the F·E·E·D·B·A·C·K lenses
- Auto-creates Google Calendar events for due dates
- Daily checkpoint nudge emails via Gmail
- Weekly digest emails Monday morning
- Programs → Projects → Cards hierarchy
- Per-card detail panel with full edit + feedback log

---

## Setup — 60 minutes total

### 1. Google Cloud setup (15 min)

Your Google Workspace **admin** needs to do this once.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a new project (e.g. "Stagework").
2. Navigate to **APIs & Services → Library**, enable:
   - Google Calendar API
   - Gmail API
   - (Optional for later phases: Sheets API, Drive API, Docs API, Admin SDK)
3. **APIs & Services → OAuth consent screen**:
   - User Type: **Internal** (this is critical — restricts to your workspace, no Google review needed)
   - App name: Stagework
   - Support email: yours
   - Add scopes: `openid`, `email`, `profile`, `calendar.events`, `gmail.send`
4. **Credentials → Create Credentials → OAuth Client ID**:
   - Application type: Web application
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/google/callback` (dev)
     - `https://stagework.yourcompany.com/api/auth/google/callback` (prod, once you have the domain)
5. Copy the **Client ID** and **Client Secret**. You'll paste them in `.env.local` next.

### 2. Supabase setup (10 min)

1. Sign up at [supabase.com](https://supabase.com), create a new project. Pick a region close to your users.
2. Wait ~2 min for it to provision.
3. **Project Settings → API**: copy `Project URL`, `anon public key`, and `service_role key`.
4. **SQL Editor** → New query → paste the contents of `supabase/schema.sql` → Run.
5. **Authentication → Providers**: turn on **Google**, paste the Client ID and Client Secret from step 1.
   - Authorized callback URL Supabase shows you: copy and **also add** to your Google OAuth client's authorized redirects.

### 3. Local dev (10 min)

```bash
# Clone & install
git clone <your-repo> stagework && cd stagework
npm install

# Configure env
cp .env.example .env.local
# Edit .env.local with values from steps 1 & 2
# Generate the encryption key:
openssl rand -base64 32   # paste as TOKEN_ENCRYPTION_KEY

# Run
npm run dev
# Open http://localhost:3000
```

Sign in with your Google account. The first user in an org becomes admin. Run `supabase/seed.sql` after sign-in if you want example programs/projects/cards.

### 4. Deploy to Vercel (15 min)

1. Push the repo to GitHub.
2. Go to [vercel.com](https://vercel.com), import the repo.
3. **Environment Variables**: paste every value from your `.env.local`. Update `NEXT_PUBLIC_APP_URL` to your production URL (e.g. `https://stagework.yourcompany.com`).
4. Add the production callback URL to your Google OAuth client (step 1.4).
5. Deploy.
6. The cron jobs (`/api/cron/checkpoint-nudges` daily, `/api/cron/weekly-digest` Mondays) are configured in `vercel.json` and run automatically. Vercel auto-injects the `CRON_SECRET` into the request.

### 5. Custom domain (optional, 10 min)

Vercel → Project → Settings → Domains. Add `stagework.yourcompany.com`. Vercel gives you a CNAME or A record to add at your DNS provider. SSL is automatic.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  Browser  (Next.js client components)         │
└────────────────────┬─────────────────────────┘
                     │ HTTPS
┌────────────────────▼─────────────────────────┐
│  Vercel  (Next.js server)                     │
│  ├── /app/page.tsx ............ landing       │
│  ├── /app/dashboard ........... main UI       │
│  ├── /app/api/auth/* .......... OAuth flow    │
│  ├── /app/api/cards ........... CRUD          │
│  ├── /app/api/feedback ........ checkpoint    │
│  └── /app/api/cron/* .......... daily/weekly  │
└────┬───────────────────┬──────────────────────┘
     │                   │
┌────▼─────────┐  ┌─────▼─────────────┐
│  Supabase    │  │  Google APIs       │
│  • Postgres  │  │  • Calendar        │
│  • Auth      │  │  • Gmail           │
│  • RLS       │  │  • (Sheets/Drive   │
└──────────────┘  │     for phase 3)   │
                  └────────────────────┘
```

## File structure

```
stagework/
├── app/
│   ├── api/
│   │   ├── auth/google/{signin,callback}/route.ts
│   │   ├── auth/signout/route.ts
│   │   ├── cards/route.ts          (GET, POST)
│   │   ├── cards/[id]/route.ts     (PATCH, DELETE)
│   │   ├── feedback/route.ts
│   │   ├── programs/route.ts
│   │   ├── projects/route.ts
│   │   └── cron/{checkpoint-nudges,weekly-digest}/route.ts
│   ├── dashboard/page.tsx
│   ├── page.tsx                    (landing)
│   ├── layout.tsx
│   └── globals.css
├── components/
│   └── DashboardClient.tsx         (the main UI)
├── lib/
│   ├── methodology.ts              (stages, checkpoints, lenses)
│   ├── types.ts
│   ├── encryption.ts               (AES-256-GCM for refresh tokens)
│   ├── supabase-{server,browser}.ts
│   └── google/
│       ├── client.ts               (OAuth + token retrieval)
│       ├── calendar.ts             (event create/update/delete)
│       └── gmail.ts                (send + email templates)
├── supabase/
│   ├── schema.sql                  (tables, RLS, triggers)
│   └── seed.sql                    (sample data)
├── middleware.ts                   (session refresh)
├── vercel.json                     (cron schedule)
└── .env.example
```

## Phase 3 & 4 stubs (not yet built)

The build plan included Sheets sync, Drive folders, and Docs notes. Hooks in the schema (`projects.sheet_id`, `cards.drive_folder_id`, `cards.doc_id`) and OAuth client are already there. To add them:

1. Add the relevant scope to `GOOGLE_SCOPES` in `lib/google/client.ts`.
2. Create `lib/google/sheets.ts` / `drive.ts` / `docs.ts` following the same pattern as `calendar.ts`.
3. Wire into the relevant API routes (e.g. `projects/route.ts` calls `createDriveFolder()` on create).

Estimated time per integration: 4–6 days of dev work.

## Security notes

- **Refresh tokens** are encrypted with AES-256-GCM before being stored in Postgres. Encryption key lives only in environment variables — never commit it.
- **Row-Level Security** policies on every table ensure users only see data for their own organization. Test by creating a second test workspace and confirming they can't see each other's cards.
- **Admin client** (`createAdminClient()`) bypasses RLS and is used only in cron jobs and the OAuth callback. Don't use it in user-facing routes without manually filtering by `org_id`.
- **Domain restriction** is enforced both by Internal OAuth (Google) and `ALLOWED_GOOGLE_DOMAIN` check (our app) — belt and suspenders.
- The `CRON_SECRET` protects cron endpoints from being called by the public.

## Common issues

**"refresh_token is null after sign-in"** — Google only sends a refresh token on the FIRST authorization, or when `prompt=consent` is set. Our signin route already passes `prompt=consent` so this should always work. If a user revokes access in their Google account, they'll get a fresh refresh token next sign-in.

**"Calendar event not appearing"** — User probably signed in before we requested calendar scope. Have them sign out and sign back in to grant the new scope.

**"RLS policy denies query"** — The user row in `public.users` is missing or has wrong `org_id`. Check that the OAuth callback's user-provisioning step ran. SQL: `SELECT * FROM public.users WHERE id = '<auth-user-id>';`

## License

Private / internal. Don't share without permission.
