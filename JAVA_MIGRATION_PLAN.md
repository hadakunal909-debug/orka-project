# Java Migration Plan — Orka Project

> **Status:** Proposal / decision document. Nothing here is built yet.
> **Date:** 2026-05-20
> **Audience:** Engineering leads + tech decision-makers evaluating whether to move the stack from Next.js/TypeScript to Java.

---

## TL;DR

Migrating the current Next.js + TypeScript app to a Java stack is **technically feasible** but **not free**:

- **Effort:** ~4–6 months for 2 engineers (full-time), or 8–12 months for 1.
- **You can't go 100% Java** — the browser runs JavaScript. Realistic outcome: Java backend + the existing React/TS frontend.
- **Best strategy:** "Strangler Fig" — port one route at a time, run both stacks in parallel, cut over gradually. Avoid a big-bang rewrite.
- **Do it if:** org mandates Java, you need deep integration with a Java-only system, or you've hit a perf wall TS can't solve.
- **Don't do it if:** you're chasing "Java is more enterprise" without a concrete reason. The current stack works.

---

## 1. Why Even Consider It?

Reasonable reasons:

1. **Org standardization.** Rest of the company runs on JVM. Shared libraries, shared ops, shared hires.
2. **Existing Java integrations.** You need to call internal Java services that don't have decent REST/gRPC APIs, only Java SDKs.
3. **Talent pool.** Your hiring pipeline is heavily Java.
4. **Long-term maintenance.** Bigger org prefers a single backend language for the next 5–10 years.
5. **Performance.** Genuine sustained CPU/concurrency wall that Node.js can't handle. (Rare for a CRUD app like this — flag this as the weakest reason for *this* app.)

Bad reasons (avoid):

- "Java is more enterprise-grade." (TypeScript is fine for enterprise; thousands of large companies run on Node.)
- "Strong typing." (TS already gives you strong typing.)
- "Compiled languages are faster." (Node performs well for IO-bound CRUD; the bottleneck here is Postgres and external APIs.)

---

## 2. Current State (Recap)

| Concern        | Today |
|----------------|-------|
| Backend        | Next.js 14 App Router (TypeScript), API routes in `app/api/*` |
| Frontend       | React 18 + TypeScript, SSR for some pages, client-rendered SPA-ish UI |
| Auth           | Supabase Auth + Google OAuth (server-side via `googleapis`) |
| DB             | Supabase (Postgres 15) with Row-Level Security |
| Realtime       | Supabase Realtime (WebSocket, JS client) |
| Email/Calendar | Google APIs via `googleapis` (Node) |
| AI             | Gemini via `@google/genai` (Node) |
| Hosting        | Vercel (serverless functions + edge), with Vercel Cron |
| Crypto         | Browser Web Crypto API (E2E DMs) + Node `crypto` (token at rest) |
| Code volume    | ~23,000 LOC TS, ~30 API endpoints, ~108 files |

---

## 3. Target Java Stack

Pick once, stick with it. Recommended choices in **bold**.

| Concern                | Options | Recommendation |
|------------------------|---------|----------------|
| Language               | Java 21 (LTS) / Kotlin / Scala | **Java 21** (matches org-standard Java; Kotlin only if your team already uses it) |
| Framework              | **Spring Boot 3** / Quarkus / Micronaut | **Spring Boot 3** — biggest ecosystem, easiest hiring, well-documented |
| Build tool             | **Gradle (Kotlin DSL)** / Maven | **Gradle** — faster, more flexible |
| DB access              | **Spring Data JPA (Hibernate)** / jOOQ / MyBatis | **jOOQ** if you want type-safe SQL close to the schema; **JPA** if you prefer ORM. For this app — **jOOQ** (the schema is rich and RLS-heavy; SQL is clearer) |
| Migrations             | **Flyway** / Liquibase | **Flyway** — port existing `supabase/*.sql` directly |
| Validation             | **Bean Validation (Jakarta)** | Replace Zod with `@Valid` + `@NotNull`/`@Size`/etc. |
| Auth                   | **Spring Security 6 + Spring OAuth2 Client** | Standard pick. Server-side OAuth flow against Google. |
| Realtime               | **Spring WebSocket / STOMP** OR keep Supabase Realtime | Keep Supabase Realtime if you stay on Supabase Postgres. Otherwise WebSocket. |
| Frontend               | **Keep React + TS** (talks to Java over REST) | Don't rewrite the UI — that doubles the project. |
| Hosting                | AWS ECS / Render / Fly.io / GCP Cloud Run | **Cloud Run** (simplest) or **ECS Fargate** (most control) — Vercel is out |
| Containers             | Docker + JIB / Buildpacks | **JIB** — Gradle plugin builds optimized OCI images without Dockerfile |
| Observability          | Micrometer + OpenTelemetry + Grafana | Standard JVM stack |
| Testing                | **JUnit 5 + Testcontainers + Spring Boot Test** | Testcontainers gives you real Postgres in CI |

---

## 4. Frontend Strategy

This is the **biggest architecture call**. Three options:

### Option A — Keep React+TS frontend, Java is backend-only ⭐ Recommended
- React app calls Java REST endpoints.
- Minimal changes to the UI code; just swap base URL and adjust response shapes.
- Frontend can keep deploying to Vercel/Cloudflare Pages even if backend moves to AWS.
- **Cost:** lowest. **Risk:** lowest.

### Option B — Rewrite UI in Thymeleaf (server-rendered)
- Traditional Java MVC: templates rendered on the server.
- Loses the SPA feel, realtime gets harder.
- Why anyone considers this: simpler ops, no SPA bundle.
- **Cost:** rewrite every page. **Risk:** UX regression.

### Option C — Vaadin Flow
- Java-based component UI framework. Write the UI in Java.
- Niche; small ecosystem; uphill for hiring frontend talent.
- **Cost:** rewrite every page. **Risk:** lock-in.

**Verdict:** Go with **A**. The UI is the most polished part of the app and there's no reason to throw it away.

---

## 5. Strategy: Strangler Fig vs Big Bang

### Big Bang (don't do this)
Rewrite everything in a branch, switch over on launch day.
- High risk: one chance to get it right; bugs land all at once.
- Long period with no new features.
- Team morale takes a hit.

### Strangler Fig ⭐ Recommended
Run Java alongside the Next.js app. Migrate one route at a time, behind a reverse proxy.

```
                       ┌──────────────────────┐
   Browser  ──→  CDN ──┤  Reverse proxy        │
                       │  (nginx / Cloudflare) │
                       └─┬──────────────┬─────┘
                         │              │
              /api/cards │              │ /api/feedback (legacy)
              (migrated) │              │
                         ▼              ▼
                  ┌──────────────┐  ┌──────────────────┐
                  │ Java Spring  │  │ Next.js (legacy) │
                  └──────────────┘  └──────────────────┘
                         │              │
                         └──────┬───────┘
                                ▼
                         ┌─────────────┐
                         │  Postgres   │
                         └─────────────┘
```

- Both stacks share the same Postgres.
- Route-by-route migration; each route gets its own QA cycle.
- Rollback is trivial: flip the proxy config back.
- Ship features in parallel.

---

## 6. Phased Plan

### Phase 0 — Decisions & Setup (1–2 weeks)
- [ ] Confirm Java migration is approved by stakeholders
- [ ] Pick stack (use §3 as starting point; lock the choices)
- [ ] Stand up reverse proxy (nginx or Cloudflare Workers) in front of the live Next.js app — **no behavior change yet**, but now you control routing
- [ ] Set up new Git repo or `/server-java` subfolder in this repo (monorepo) for the Java project
- [ ] CI/CD: GitHub Actions runs `./gradlew build test` + builds container image
- [ ] Provision dev/staging hosting (Cloud Run / Render)
- [ ] Decision: stay on Supabase Postgres, or migrate DB to managed RDS/Cloud SQL? **Recommendation: stay on Supabase Postgres** unless there's a compliance reason to leave. Saves weeks.

**Deliverable:** Hello-world Java service deployed to staging, behind the reverse proxy, on a path like `/api/_health`.

### Phase 1 — Foundations (2–3 weeks)
- [ ] DB connectivity (Spring Boot + jOOQ + Flyway)
- [ ] Port `supabase/schema.sql` + all migrations into Flyway (`db/migration/V001__schema.sql`...)
- [ ] Generate jOOQ classes from the schema
- [ ] Wire `@ConfigurationProperties` for env vars (Supabase URL, Google OAuth, etc.)
- [ ] Set up structured logging (Logback + JSON encoder), Micrometer metrics, health endpoints
- [ ] Set up Testcontainers — every test gets a clean Postgres
- [ ] Decide how to handle Supabase RLS:
  - **Option 1:** Bypass RLS, enforce access control in Java only (use service-role connection)
  - **Option 2:** Set `request.jwt.claim.sub` per request so RLS still applies
  - **Recommendation:** Option 1 + reuse the logic in `lib/access.ts` translated to Java. RLS becomes a defense-in-depth layer.

**Deliverable:** Java service can read/write to Postgres in staging, with migrations and tests passing.

### Phase 2 — Auth (2–3 weeks)
The trickiest part. Auth touches every request.

- [ ] Implement Google OAuth flow (Spring Security OAuth2 Client)
- [ ] Build session model — **decision:** stick with Supabase Auth JWT cookies (Java validates them) or move to Spring sessions?
  - **Recommendation:** during migration, Java *validates* the existing Supabase JWT cookie. Both stacks accept the same session. Switch to Java-issued sessions only after Next.js is decommissioned.
- [ ] Port `lib/security.ts` (state token verification) + domain restriction check
- [ ] Port refresh-token AES-256-GCM encryption (Java `Cipher` with `AES/GCM/NoPadding`) — bytes are compatible across runtimes if you keep the same key + IV layout
- [ ] Spring Security filter chain that:
  - Reads the cookie
  - Validates the JWT against Supabase's JWKS
  - Loads the user row from Postgres
  - Populates `SecurityContext` for downstream code

**Deliverable:** Java service correctly identifies the same user as the Next.js app from the same cookie. Both can run in parallel.

### Phase 3 — Port API Routes (8–12 weeks) ⚠ Biggest phase
~30 endpoints to port. Group by risk:

**Low-risk, port first** (good for getting velocity):
1. `GET /api/users/[id]`, `PATCH /api/users/[id]`
2. `GET /api/departments`, `GET /api/teams`
3. `GET /api/projects`, `GET /api/cards`
4. Health checks, pings

**Medium-risk:**
5. `POST/PATCH/DELETE` for cards, projects, departments, teams
6. `POST /api/feedback` + routing
7. Workspaces + public share token
8. Messages (channel chat)

**High-risk, port last:**
9. OAuth callback (user provisioning) — has the most failure modes
10. Cron handlers (checkpoint nudges, weekly digest)
11. Google Calendar / Gmail send paths
12. Soft-delete + restore (`/api/admin/delete-log`)
13. Realtime broadcasts (if you decide to drop Supabase Realtime)

For **each endpoint**:
- [ ] Translate Zod schema → Bean Validation
- [ ] Translate access check from `lib/access.ts` to Java service class
- [ ] Write Spring controller + service + repository
- [ ] Write integration test (Testcontainers + MockMvc)
- [ ] Flip the reverse proxy to send this route to Java
- [ ] Monitor for 24–48 hours, then move on

**Don't** port the dev-only endpoints (`/api/dev/*`, `/api/auth/dev-signin`). Mark them deprecated and drop them at cutover.

**Deliverable:** All production endpoints served by Java; Next.js still rendering the UI.

### Phase 4 — Google Integrations (2–3 weeks)
- [ ] Replace `lib/google/calendar.ts` with Java's `google-api-services-calendar`
- [ ] Replace `lib/google/gmail.ts` with `google-api-services-gmail`
- [ ] Port email templates (today they're HTML strings in TS — move to a templating engine: Pebble, Thymeleaf, or Mustache. **Pebble is closest to Twig/Liquid and pleasant.**)
- [ ] Re-test end-to-end: card with due date → event lands on Google Calendar.

### Phase 5 — Cron Jobs (1 week)
- [ ] Port `/api/cron/checkpoint-nudges` → Spring `@Scheduled(cron = "0 0 14 * * *")`
- [ ] Port `/api/cron/weekly-digest` → `@Scheduled(cron = "0 0 13 * * MON")`
- [ ] **Lock for HA:** use Shedlock + Postgres advisory lock so only one instance runs each job
- [ ] Remove `vercel.json` cron entries during cutover

### Phase 6 — Realtime (1–2 weeks)
Two paths:

**Path A — Keep Supabase Realtime.** The browser already subscribes directly to Supabase. Java doesn't need to do anything. ⭐
**Path B — Move to Spring WebSocket + STOMP.** Java publishes change events; React subscribes. More work, more control.

**Recommendation: Path A.** Drop only if you leave Supabase entirely.

### Phase 7 — AI Endpoint (3–5 days)
- [ ] Port `/api/agent/draft-card` and `/api/agent/ping`
- [ ] Use the official Google AI Java SDK (`google-cloud-aiplatform` for Vertex, or community Gemini Java client)

### Phase 8 — Cutover (1–2 weeks)
- [ ] Final route flipped to Java
- [ ] Run both stacks in parallel for 1 week with traffic 100% on Java (Next.js as warm rollback)
- [ ] Monitor: error rates, latency p95, DB connection pool, Google API quota
- [ ] If clean for 1 week → decommission Next.js

### Phase 9 — Decommission (1 week)
- [ ] Remove Next.js API routes (keep only the pages/components in a separate `web/` repo if you split it)
- [ ] Delete Vercel project (or keep it for the frontend only)
- [ ] Archive old code (don't `rm` it for at least 90 days — keep in a `legacy/` branch)
- [ ] Update `HANDOFF.md`, README, runbooks

---

## 7. Effort & Timeline

| Phase | Engineers × Weeks | Notes |
|-------|-------------------|-------|
| 0. Setup | 2 × 2 = 4 EW | Mostly DevOps + decisions |
| 1. Foundations | 2 × 3 = 6 EW | DB + jOOQ + Flyway |
| 2. Auth | 2 × 3 = 6 EW | OAuth is fiddly; allow buffer |
| 3. API routes | 2 × 10 = 20 EW | Largest by far |
| 4. Google APIs | 2 × 2.5 = 5 EW | Translation + testing |
| 5. Cron | 1 × 1 = 1 EW | Small |
| 6. Realtime (if Path B) | 2 × 1.5 = 3 EW | Skip if Path A |
| 7. AI | 1 × 1 = 1 EW | Small |
| 8. Cutover | 2 × 2 = 4 EW | Mostly observation |
| 9. Decommission | 1 × 1 = 1 EW | Cleanup |
| **Total** | **~51 EW** | **~25 weeks calendar with 2 engineers full-time** |

Add **30% buffer** for unknowns → **~30–35 calendar weeks** = **7–8 months**.

> If you go with **1 engineer**, double the calendar time. If you have **3 engineers**, you save maybe 20% — phases have a critical path (auth before APIs, foundations before everything).

---

## 8. Pros

| Pro | Detail |
|-----|--------|
| Org alignment | Same language as the rest of the company → shared libs, easier transfers, simpler hiring |
| Mature ecosystem | Spring is battle-tested in enterprise. Strong DI, AOP, transactions, security. |
| Long-term hires | Larger Java labor market in many regions (esp. enterprise dev) |
| JVM operational tooling | Profilers (JFR, async-profiler), heap dumps, GC introspection are best-in-class |
| Real concurrency | True multi-threading (with Loom virtual threads in Java 21+) for CPU-bound work |
| Type safety + compile-time guarantees | Java's type system catches errors at compile time. (TS does too, but Java's is stricter at runtime.) |
| Code reuse with backend services | If you have other Java microservices, shared DTOs and libraries |
| No more "two languages" in pure-backend orgs | Backend devs don't need to learn TS |

---

## 9. Cons

| Con | Detail |
|-----|--------|
| **Time + cost** | 7–8 months for 2 engineers = ~$400K–$700K in fully-loaded engineering time. Doing nothing costs $0. |
| **Opportunity cost** | Those 7–8 months are 7–8 months of zero new features |
| **You still need TS** | The browser frontend stays in TS/React. You don't eliminate JS, you just add Java |
| **More moving parts** | Two services (Java + React) instead of one Next.js app → more deploys, more environments, more configs |
| **Hosting changes** | Vercel is out. New hosting = new IAM, new CI deploy, new ops on-call |
| **Slower dev iteration** | JVM startup, recompile cycles slower than Next.js HMR. Spring Boot devtools helps but not magic |
| **More boilerplate** | A CRUD endpoint that's 30 lines in Next.js is 100+ in Spring (controller + service + repo + DTOs + tests) |
| **Cold start on serverless** | Cloud Run / Lambda Java cold starts can be 3–10s without GraalVM native image. Mitigations exist but add complexity |
| **Memory footprint** | A Spring Boot instance baseline ~300–500 MB. Node baseline ~50–100 MB. More $/instance on small workloads |
| **Migration risk** | Every migrated endpoint is a chance to introduce a regression. RLS / access control is especially risky |
| **Realtime regression risk** | If you ditch Supabase Realtime, you rebuild a working feature from scratch |
| **Team morale** | "We're rewriting working code" projects are notoriously demotivating unless the team is genuinely bought in |

---

## 10. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Access control regression — Java RLS interpretation diverges from `lib/access.ts` | High | Reuse RLS at DB level as defense-in-depth + cross-org integration tests written before porting |
| Encrypted refresh tokens become unreadable in Java | Medium | Write a tiny Node CLI that decrypts with the existing key, encrypts in identical Java-compatible format. Test round-trip before migrating users |
| Cron jobs run twice (or not at all) when both stacks live | High | Use Shedlock from day one of Java cron. Disable Vercel crons the day Java crons go live |
| OAuth scope drift — Java requests slightly different scopes | Medium | Lock scope list in a shared config; CI test compares Java vs TS scope lists |
| Hosting bill spikes (Cloud Run cold-start scaling) | Medium | Reserve min instances during cutover. Monitor latency and scale-from-zero behavior |
| Migration loses momentum at 70% complete | High | Strangler-fig commits you to small wins. Public roadmap with weekly demoable progress |
| Team loses two senior engineers to other projects | Medium | Cross-train; doc-as-you-go; no single point of failure |

---

## 11. Decision Matrix

Answer "yes" or "no" to each. **Migrate only if 3+ are "yes".**

- [ ] Is the rest of our org's backend already in Java/JVM?
- [ ] Do we have a hiring pipeline that's much stronger for Java than for TS?
- [ ] Do we have a concrete plan that requires deep integration with a Java-only library or service?
- [ ] Do we have 6+ months and 2+ engineers we can fully dedicate to this?
- [ ] Have we hit a performance, scaling, or correctness wall the current stack can't solve?
- [ ] Is leadership willing to accept ~6 months of zero net-new features?
- [ ] Is the current team genuinely willing to do this (not just told to)?

**0–2 yes:** Don't migrate. Invest those 6 months elsewhere.
**3–4 yes:** Migrate, but seriously consider a pilot service (one new feature in Java) before committing.
**5+ yes:** Migrate, full strangler-fig plan above.

---

## 12. Alternatives to Full Migration

If you want some Java benefits without the full cost:

1. **Polyglot — Java for new services only.** Build the *next* service in Spring Boot. Keep the existing app on Next.js. Lower risk; team learns Java gradually.
2. **Java sidecar.** Build a small Java service for a specific need (e.g., a heavy report generator) and call it from Next.js. Validates the stack without rewriting working code.
3. **Move to Kotlin instead of Java.** Same JVM benefits, much less boilerplate, modern syntax — but smaller talent pool.
4. **Stay on TS, address the actual pain point.** If the real problem is "deploys are slow" or "tests are flaky," fix that directly; it's 10× cheaper than a rewrite.

---

## 13. Recommendation

For *this* app, at *this* size, with the current team — **don't migrate to Java unless there's a concrete organizational reason (option #1 in §1).** The TS/Next.js stack is well-matched to the problem.

If you do migrate:
1. Lock the answers in §11 first.
2. Run a 4-week pilot — port one route (`/api/users/[id]` is a good candidate) to Java, run it in production behind the strangler-fig proxy, measure.
3. Only commit to the full plan after the pilot proves the toolchain and timeline.

---

*End of plan. Update this doc as decisions land and phases complete.*
