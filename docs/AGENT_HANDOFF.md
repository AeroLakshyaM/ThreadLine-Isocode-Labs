# Threadline — Current State and Next-Agent Handoff

**Prepared:** 9 November 2026  
**Repository:** `D:\Threadline - Isocode Labs\ThreadLine-Isocode-Labs`  
**Purpose:** Give the next engineering agent a reliable map of the product, role workflows, implementation state, known gaps, and safest next actions. This document describes the repository, not a verified production deployment.

## 1. Instructions for the next agent

Continue the existing Threadline implementation. Do not rebuild it or replace its architecture without a clear technical reason. First inspect the current working tree, migrations, existing QA report, and environment configuration. Treat all hosted Supabase details as untrusted until the project owner confirms that the project is isolated staging with synthetic data.

Work in this order:

1. Establish whether there is a disposable staging Supabase project and identify its project reference. Never apply migrations, seed data, or destructive tests to a customer/production project.
2. Inspect Supabase migration history. Apply only migrations missing from that staging project, in order, after reviewing SQL. Do not re-run one-time migrations blindly.
3. Configure/deploy Edge Functions to staging with the exact staging app origin and server-side secrets. Verify CORS with actual requests from that origin.
4. Create synthetic users for admin, merchandiser, supervisor, and buyer; load synthetic buyers, units, calendars, routes, TNA, lines, and orders.
5. Reproduce and resolve the production-plan save issue from the real RPC response. Exercise each role workflow and the six required product flows described below.
6. Test RLS, buyer isolation, signed media, RPC permissions, account-management protection, offline queue/retry, actual report downloads, mobile responsiveness, and slow-network behavior.
7. Record exact commands, requests, results, and remaining issues in `docs/TEST_REPORT.md`. Classify requirements as PASS only when executed successfully. Do not infer success from a screen, static code review, or successful build.
8. Ask before production deployment or any production data change. Do not fabricate API responses, test results, or deployment status.

## 2. Product purpose and architecture

Threadline is a mobile-first production order tracking app for garment manufacturing teams. The intended flow is: an administrator configures a verified workspace; a merchandiser creates and plans orders; factory supervisors report period output and issues, including optional photos/audio; the app calculates progress and production risk; buyers see only their own released orders and explicitly buyer-safe evidence; the merchandiser can produce a buyer-specific weekly PDF or Excel report.

Current architecture:

- React, TypeScript, Vite, and a PWA frontend.
- Supabase Auth, PostgreSQL, Row Level Security, RPCs, private Storage, and Edge Functions.
- IndexedDB-backed offline queue for production updates, with client UUIDs intended to prevent duplicate sync.
- `src/App.tsx` contains most screens and interaction flows; `src/domain.ts` contains date/progress/report logic; `src/liveData.ts` loads and shapes live Supabase data; `src/offline.ts` manages local pending production work; `src/types.ts` defines shared types.
- SQL is in `supabase/migrations/`; Edge Functions are `manage-users`, `approved-buyer-media`, `issue-assist`, and `transcribe-issue`.
- `tests/domain.test.mjs` covers a small set of domain behaviors. `npm test` and `npm run build` are the local checks documented in the QA report.
- A synthetic preview mode exists for exploring UI. Preview records are not factory data, do not sync, and must not be treated as proof of live backend behavior.

## 3. Roles and intended workflows

### Administrator

**Workspace setup** (`Workspace setup`):

1. Add buyer accounts using confirmed customer names.
2. Add production units and set the correct working days/timezone.
3. Add production lines and assign each line to a unit.
4. Create and activate approved stage-route templates, with stages in sequence.
5. Create and activate approved TNA templates with milestone offsets from the ex-factory date.
6. Add unit holidays.
7. Configure risk thresholds only after company approval; empty thresholds mean no policy is active.
8. Review/edit workspace records in the configuration directory. Records used by released/completed orders should be locked. Used stage/TNA templates can be copied into a new version for future plans.

**User management**: create accounts, assign `admin`, `merchandiser`, `supervisor`, or `buyer` role, update email/display name, activate/deactivate accounts, reset passwords, and map each buyer user to a buyer account. The `manage-users` Edge Function uses the service-role key server-side and checks that the caller is an active administrator. The first administrator is still bootstrapped through trusted Supabase project setup; later account management is intended to happen in the app.

**Profile/password support**: every role has a profile page showing their account details. A user can request a password change with an optional note. The admin gets an in-app pending badge/list and sets a temporary password through the existing managed-user reset path, then marks the request handled. The temporary password must be shared securely out of band. No email/push notifications are configured.

**Issue/media review**: inspect production issues, play original audio where available, request transcription or translation suggestions with the displayed consent flow, correct the result, and separately approve buyer-safe remarks/photos. Create and update recovery actions with owner, action, follow-up date, and status.

### Merchandiser

1. Review the order board; filter by buyer, unit, and ship week, and open an order for details.
2. Create a draft order with buyer, unit, PO, style, colour, ex-factory date, and size-wise quantities. The server-side draft RPC derives the total from the size matrix; duplicate PO per buyer is intended to be rejected.
3. Plan a draft by choosing an active stage route and TNA template; review stages, targets, optional line assignments, supervisor assignments, and generated milestone dates. Save the plan or release it when ready.
4. A released plan is intended to preserve its production configuration/history. Milestone status can still move through upcoming, in-progress, complete, at-risk, and overdue states.
5. Review issues and recovery actions, and make buyer-safe approvals explicit.
6. Export a selected buyer/week report as PDF or Excel. The selected week is meant to control production-update activity included. Report snapshots distinguish historical-by-reporting-date quantities from order/milestone values current at export.

**Known blocker:** a production-plan save failure was reported earlier. The app surfaces Supabase RPC errors, but the actual failure was never diagnosed against a confirmed staging database. Do not claim the save issue is fixed until it is reproduced and verified.

### Factory supervisor

1. Sign in with an administrator-provisioned account assigned to production work.
2. Open an order and select an assigned stage and (if configured) line.
3. Enter quantity produced for the reporting period—not a cumulative lifetime total. If output is zero, provide the required reason/note.
4. Optionally add a text issue, a photo, and/or a voice note. A blocking stage requires an explanatory note or recording.
5. Save; the update is intended to persist locally first and sync when connected. Use the pending/sync state and retry when back online. Do not clear browser/site data while entries are pending.

Voice-note behavior: the supervisor records the original audio in the browser using MediaRecorder. The recording is retained and attached to the update. This is **not** a live voice assistant and does **not** automatically turn speech into text while recording. A reviewer later initiates transcription from issue review. The current `transcribe-issue` function sends eligible audio (up to 5 MB) to Gemini when configured and consented; the transcript is a suggestion for human review. A separate human-triggered AI action can suggest an English translation/category (NVIDIA first, Gemini fallback). Provider data-use approval and Tamil accuracy/device testing remain open.

### Buyer

1. Sign in with an account mapped to that buyer by the administrator.
2. See only the buyer’s released/shared orders in a read-only portal.
3. View buyer-visible milestones, progress, approved remarks, and explicitly approved photos when available.
4. No internal issue notes or unapproved media should be visible. This is intended to be enforced by RLS/RPCs and signed-media authorization, not merely hidden in the UI.

## 4. Feature inventory and evidence status

Status means code exists unless explicitly stated otherwise; backend-dependent features below are not production-verified.

| Feature | Current implementation/evidence | Status |
|---|---|---|
| Role-based sign-in and landing areas | Supabase Auth/profile role routing exists | NOT TESTED with live accounts |
| Workspace buyers/units/lines/routes/TNA/calendars/risk | Admin setup and directory/edit UI exist | PARTIAL; live CRUD and approval data not tested |
| User provisioning, roles, buyer mapping, password reset/deactivation | Admin page plus `manage-users` function; self/last-admin protections reviewed in code | PARTIAL; function/Auth operations not executed |
| User profile/password request | Profile UI, in-app admin request queue, migration 002 | PARTIAL; migration and live request/reset not tested; no email alerts |
| Draft order setup and size totals | UI and server-side RPC path | PARTIAL; not executed against Supabase |
| Plan/release and TNA generation | Template selection and UTC date-only offset logic; date calculations have unit tests | PARTIAL; plan-save defect remains unresolved/unverified |
| Released-plan immutability | Migration 003 triggers and UI locked states; template version-copy flow | PARTIAL; SQL/direct API enforcement not executed |
| Supervisor production reporting | Period output, zero reason, photo/text/audio controls, offline queue | PARTIAL or NOT TESTED at runtime |
| Production board/filter/risk warnings | Buyer/unit/ship-week filters and risk calculation are implemented | NOT TESTED with realistic history/calendar/approved thresholds |
| Buyer portal and data isolation | Buyer RPC/RLS and read-only UI paths exist | PARTIAL; no adversarial cross-buyer test |
| Photo approval/protected access | Private bucket, approval flow, signed-media function | PARTIAL; storage policy and signed URL access not tested |
| Recovery actions | Owner/action/follow-up/status UI and schema changes | PARTIAL; migration/update path not executed |
| Weekly PDF and Excel | Client-side export; selected week query and per-stage aggregation logic; snapshot persistence path | PARTIAL; no authenticated downloads tested; ExcelJS chunk is large |
| Voice transcription/translation | Browser recording, human-triggered provider-backed functions, consent and review UI | PARTIAL; no provider call or representative Tamil audio test |
| Offline sync/retry/idempotency | IndexedDB queue and client UUID paths | PARTIAL; no real disconnect/retry/device test |
| Mobile responsiveness/performance | Mobile-first UI and CSS; bundle splitting | NOT TESTED on target devices or slow networks |

## 5. Migrations and deployment requirements

Migrations present in this repository, in order:

1. `supabase/migrations/202611050001_initial_schema.sql` — initial schema, core policies/RPCs/storage foundation.
2. `supabase/migrations/202611090001_stabilisation.sql` — release timestamp, recovery-action status/policy/audit, report snapshot, buyer progress/media RPC updates.
3. `supabase/migrations/202611090002_password_change_requests.sql` — profile password-change request workflow.
4. `supabase/migrations/202611090003_release_configuration_locks.sql` — configuration and released-plan immutability triggers.

The QA notes say migrations 001–003 above (numbered 001, 002, 003 after the initial schema) have **not** been applied/tested in Supabase. Confirm actual migration history before applying. Historical `released_at` backfill in migration 001 uses `updated_at` as an approximation, so old orders may appear in the wrong historical week. The release-lock migration freezes a unit's shared calendar/risk policy after a released order uses it; a separate unit configuration may be needed for changed future settings.

Browser build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` only. Edge Function secrets: `APP_ORIGIN` (exact scheme+host of deployed app), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Optional AI secrets after explicit data-handling approval: `NVIDIA_API_KEY`, `GEMINI_API_KEY`, and optional model overrides `NVIDIA_MODEL`, `GEMINI_MODEL`, `GEMINI_TRANSCRIBE_MODEL`. Never put a service-role or provider key in browser variables. The repo's `.env.example` includes a hosted project URL/key; its environment is not verified and must not be assumed to be staging.

The initial admin, migrations, Edge Function deployment/secrets, hosting/CORS origin, and project operations still require trusted project setup. After that, ordinary workspace and user data management is intended to be in-app.

## 6. Prior defects and fixes recorded

- A runtime crash reading `stageOptions` when there were no available orders was guarded with an empty state.
- Managed-user update now includes email in its request payload to match the Edge Function contract.
- TNA offsets use UTC date-only arithmetic to avoid local timezone one-day shifts.
- Buyer progress is described as output at the most advanced reported stage against that stage's target, instead of implying all stages are complete.
- Milestone status controls and recovery-action form/status updates were added.
- Weekly report logic now filters production activity by selected week and aggregates by stage; some report fields remain current-at-export rather than historical.
- Code splitting separates core vendor libraries and lazy-loads report engines; ExcelJS is still a large lazy chunk.
- Production-plan save was **not** confirmed fixed because no real RPC error was captured from a disposable test project.

See `docs/TEST_REPORT.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/KNOWN_LIMITATIONS.md`, and `docs/OPEN_DECISIONS.md` for more detail. These supporting documents can become stale; inspect the code and current migration state before changing behavior.

## 7. Local checks and verification boundaries

The latest documented local evidence in `docs/TEST_REPORT.md`:

- `npm test`: PASS, 3 domain tests (date offsets/invalid input and selected-week filtering/grouping).
- `npm run build`: PASS, TypeScript + Vite production build. Vite warns that the lazily loaded ExcelJS chunk is over 500 KB.
- `git diff --check`: no source whitespace errors; line-ending warning noted for `package.json`.
- Database migrations, Auth, RLS, Edge Functions/CORS, media access, offline sync, Tamil transcription, mobile/network performance, and actual PDF/XLSX downloads: NOT TESTED.

These are the last recorded results, not evidence that a new agent's current environment has the same working tree. Re-run relevant local checks after code changes. Never report live acceptance based solely on them.

## 8. Open product decisions

Get confirmed company/factory information before treating any configuration as real: buyer names and assignments; production units/timezones/working days/holidays; approved garment routes; TNA milestone names, offsets and visibility; line vs stage-total reporting; risk thresholds and approver; supervisor assignment/release permissions; photo approval owner/retention/buyer rules; Tamil/audio consent and approved AI data handling; target devices/audio limits; report week boundaries, language, branding, archive and retention; hosting region, backups, restore targets, and account recovery. Interview insights about Aadiba Manufacturers are workflow research, not proof that Aadiba is Company A. Synthetic seed names/templates are illustrative and inactive; seed does not establish factory calendars or approved risk thresholds.

## 9. Paste-ready assignment for the next agent

> You are continuing the existing Threadline application in this repository. Read `docs/AGENT_HANDOFF.md`, `docs/TEST_REPORT.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/OPEN_DECISIONS.md`, and inspect the current source/migrations before making changes. Do not rebuild the architecture.
>
> The goal is to stabilise and demonstrate the current app end to end, not merely make the screens look complete. First determine whether a confirmed disposable staging Supabase project is available. Never use an unverified `.env.example` project or production data. If staging is not available, continue useful local/static work and clearly report which live checks are blocked; do not invent results.
>
> Prioritise: (1) reproduce and fix plan save using its actual Supabase RPC error, (2) verify migration ordering/status and apply only missing migrations to staging, (3) deploy/configure Edge Functions and exact CORS origin, (4) test order creation/TNA, supervisor updates, board filters/delay warnings, buyer portal/isolation, and weekly PDF/XLSX downloads with synthetic data, (5) verify all four roles, RLS/RPC permissions, account management/self-protection, approved media, profile password requests, release locks, offline persistence/idempotent retry/photo upload, and Edge Function auth/CORS, (6) validate human-triggered Tamil transcription/translation only after data-handling approval, and (7) test responsive UI/performance on target mobile and slow network.
>
> Update `docs/TEST_REPORT.md` with issues, changes, files, migration/environment needs, executed tests and actual results, remaining defects, security limitations, and deployment instructions. Label every requirement PASS/PARTIAL/FAIL/NOT TESTED and include the evidence. Do not claim a test passed unless it was run. Do not deploy or change production data without approval.

## Latest change: merchandiser workspace ownership

The role split was revised after the original workflow write-up. Merchandisers own operational workspace setup and production operations: buyer accounts, units/calendars, lines, stage/TNA templates, holidays, authorized risk policies, order creation/planning/release, issue and photo review, and reports. Administrators own account provisioning, role/activity/email/password management, buyer-user mapping, and password-change requests, plus their own profile. They no longer have operational screens or operational write authority.

This requires `supabase/migrations/202611090004_merchandiser_workspace_authority.sql` after the initial schema and migrations 001–003. The migration updates workspace/order RLS policies, order RPC role checks, and `save_order_plan` to return a stage-and-milestone-specific validation error; it also removes direct client mutations of profiles and buyer mappings in favor of the authenticated `manage-users` Edge Function. Redeploy `issue-assist` and `transcribe-issue` to enforce merchandiser-only access. None of these backend changes were applied/tested in Supabase as of this update.

The plan modal now names the stage, the invalid milestone, and the selected TNA template when it detects a mismatch, and suggests selecting a milestone in the chosen plan or clearing the link. Verify both client and RPC errors on staging after migration 004 is applied. Confirm merchandisers can perform setup and order work while admins are denied those operations and can still use User management.

After this update, local `npm test` passes 4 domain tests and `npm run build` passes. SQL migration execution, Edge Function redeployment, and staging role/plan checks remain outstanding.

