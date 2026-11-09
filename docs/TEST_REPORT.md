# Threadline stabilisation and QA report

**Prepared:** 2026-11-09
**Repository:** `D:\Threadline - Isocode Labs\ThreadLine-Isocode-Labs`
**Scope:** Targeted stabilisation of the existing React/Vite/Supabase implementation. No redesign or production deployment was performed.

> **Current P1 validation addendum (2026-11-09):** The requested P1 tests were not run against staging because no confirmed staging connection is available in this workspace. There are no Supabase environment variables or Supabase CLI configured. `.env.example` contains a hosted project URL, but its environment is unverified; it was not contacted or written to. See “P1 Core Product Validation” at the end of this report for per-test records. Local tests/build pass but do not substitute for staging validation.

## Executive status

Local TypeScript compilation, Vite production bundling, and three focused domain tests pass. The changes address the known frontend defects and add a migration for schema changes. The connected Supabase environment could not be safely identified as an isolated test project: no local test credentials, Supabase CLI, or disposable project configuration were available. No database migration, seed data, authentication request, Edge Function call, or production write was run. Consequently, the application is **not yet demonstrably verified end to end**, and live/database-dependent requirements remain partial or not tested.

## Prioritised remediation performed

1. **P0 — Protect data:** verified that no isolated Supabase test credentials or CLI are configured; did not call the hosted URL shown in `.env.example` because its environment is unconfirmed.
2. **P1 — Correct data contracts and dates:** included email in managed-user update requests; switched TNA offset arithmetic to UTC date-only operations; clarified buyer progress as cumulative output for the most advanced stage and its stage target.
3. **P1 — Complete workflows:** added editable milestone states and recovery-action creation/status updates; changed weekly reports to load activity for the selected week, group output by stage, persist a report snapshot, and disclose which fields are current-at-export versus historical-by-reporting-date.
4. **P2 — Local verification:** added domain tests and Vite chunk splitting; ran the build and test suite.
5. **P0 — External verification gate remains:** live integration, security, offline, device, and export-download testing still needs a separate synthetic-data Supabase project.

## Issues identified and changes made

- **Empty supervisor order list:** runtime error evidence pointed to `UpdateModal` reading `stageOptions` when an order list was empty. The modal now renders an explanatory empty state before accessing order fields. The production build passes after this guard; this exact browser path has not been reproduced in an end-to-end test.
- **Managed-user editing:** the frontend now sends the email field required by `manage-users` when updating a user. Static review confirmed the Edge Function checks the active administrator, role, buyer mapping, email, password length, last active administrator, and self-deactivation protections. Create/edit/password reset/deactivation were not exercised against Auth.
- **TNA timezone drift:** TNA dates now use UTC calendar arithmetic on `YYYY-MM-DD` values rather than local midnight converted through ISO UTC. The new tests cover month/year boundaries and invalid inputs.
- **Buyer progress ambiguity:** buyer progress is labelled as the most advanced stage’s reported quantity versus that stage’s target. The buyer RPC now returns the stage name and target; the old unconditional “In production” assignment was removed. Direct buyer API isolation remains untested.
- **Milestone status:** admin/merchandiser controls now update `upcoming`, `in_progress`, `complete`, `at_risk`, or `overdue`; buyer view maps these to status display. A live database update was not tested.
- **Recovery actions:** the placeholder has been replaced by a form with stage, action description, owner, follow-up date, and status; admins/merchandisers can change action status. Migration adds status, updated timestamp, audit trigger, and update policy. This depends on applying the migration.
- **Weekly reporting:** exports now query production updates between the selected week’s dates, group quantities by stage so quantities from different production stages are not falsely presented as unique garment totals, include buyer-visible milestones and a persisted JSON snapshot, and block export if weekly activity failed to load. The initial preview reports this week’s output and average current-stage progress.
- **Historical reporting limitation:** weekly stage quantities use `reporting_date`, but status and milestones are current when the report is exported. Historical release timestamps did not exist; the migration backfills them from `updated_at`, which is only an approximation for existing orders. Old releases can therefore be assigned to an inaccurate week. New releases get a release timestamp going forward.
- **Buyer media:** static review confirms the signed-media Edge Function requires an authenticated buyer and checks a user-scoped ownership/approval RPC before a service-role key signs a short-lived URL. The migration aligns completed-order access for approved media with the buyer portal. Actual storage policies, signed URL access, and cross-buyer denial were not tested.
- **Production-plan save:** the client already surfaces the Supabase RPC error detail. The actual save failure could not be diagnosed against the connected database without a confirmed test environment and real database response. No claim is made that this defect is fixed.
- **Bundle size:** React, Supabase and icon code are separated into chunks; PDF and Excel engines remain dynamically loaded. The resulting main app bundle is about 140 KB minified; React is about 223 KB, Supabase about 229 KB, PDF engine about 391 KB and ExcelJS about 940 KB. PDF/Excel are loaded only when reports are generated. ExcelJS remains a large download and the PWA precaches generated assets; low-end device and slow-network behaviour still needs measurement.

## Files changed

- `src/App.tsx` — managed-user payload, TNA date offsets, milestone status UI, recovery-action workflow, buyer view, selected-week report query/export.
- `src/liveData.ts` — buyer stage progress contract, stage target, release timestamp and milestone IDs.
- `src/types.ts` — milestone status, release timestamp and progress-target types.
- `src/domain.ts` — date-only math, progress percent, weekly report snapshot logic.
- `src/styles.css` — recovery and milestone workflow styling.
- `supabase/migrations/202611090001_stabilisation.sql` — release tracking, recovery statuses/policy/audit, report snapshot, buyer progress RPC and approved-photo RPC updates.
- `tests/domain.test.mjs` — local tests for date arithmetic and weekly report selection/grouping.
- `package.json` — `npm test` script.
- `vite.config.ts` — vendor chunk splitting.

## Database migration required

`supabase/migrations/202611090001_stabilisation.sql` is required before using the new live milestone, recovery-action, buyer progress, release-date, and weekly report paths. Apply it to a disposable test project first, after applying the repository’s initial schema. **It has not been applied here.** Review its historical `released_at = updated_at` backfill limitation before using it for customer reporting. Do not apply to production until staging verification and approval.

## Environment variables

**Browser build:**

- `VITE_SUPABASE_URL` — Supabase project URL.
- `VITE_SUPABASE_ANON_KEY` — publishable/anon key only. Never use the service-role key in browser variables.

**Supabase Edge Function secrets:**

- `APP_ORIGIN` — exact deployed website origin (scheme + host, no path, e.g. `https://threadline-ruddy.vercel.app`).
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only; required by user management and protected media functions.
- Optional, only after approving provider data handling: `NVIDIA_API_KEY`, `GEMINI_API_KEY`; optional model overrides `NVIDIA_MODEL`, `GEMINI_MODEL`, `GEMINI_TRANSCRIBE_MODEL`.

The repository’s `.env.example` contains a hosted project URL and publishable key, but that is not proof it is a test project. This report did not connect to it. There is no `.env.test` or configured local test Supabase project in the workspace.

## Tests executed and actual results

| Test | Result | Evidence / limits |
|---|---|---|
| `npm test` | **PASS** | 3 tests passed: date-only offsets across month/year boundaries, invalid dates/offsets, selected-week filtering and per-stage aggregation with buyer-safe milestones. These are domain tests, not database integration tests. |
| `npm run build` | **PASS** | TypeScript build and Vite production build completed. Chunk report recorded above. Vite still warns that the lazy ExcelJS chunk exceeds 500 KB. |
| `git diff --check` | **PASS with line-ending warning** | No source whitespace errors reported; Git notes expected CRLF conversion for `package.json`. |
| Migration application / SQL execution | **NOT TESTED** | No disposable Supabase connection or CLI was configured. |
| Browser/mobile/device and network testing | **NOT TESTED** | No low-end Android device, throttled network, or browser automation run. |
| Actual PDF/XLSX downloads | **NOT TESTED** | Build confirms report chunks compile; no signed-in workspace was available to execute the report flow. |

## Requirement classification

### Six must-have requirements

| Requirement | Classification | What evidence exists / what remains |
|---|---|---|
| Order creation and TNA generation | **PARTIAL** | Existing UI/RPC path remains; date-offset logic is unit-tested. Order creation, plan save and generated dates were not run against Supabase; known plan-save failure remains unverified. |
| Supervisor daily production updates | **NOT TESTED** | No supervisor sign-in, photo upload, voice note, offline sync, or update submission was exercised. |
| Order board and buyer/unit/ship-week filters | **NOT TESTED** | No runtime filter interaction was performed. |
| Production delay warnings | **NOT TESTED** | No synthetic production history/risk policy was loaded into a database to verify warning calculations. |
| Buyer-specific read-only portal | **PARTIAL** | Buyer progress contract and buyer-safe RPC/media checks were reviewed and updated. No buyer session, direct API isolation test, or RLS enforcement test was executed. |
| Weekly PDF and Excel exports | **PARTIAL** | Selected-week data logic has unit coverage and build succeeds. No live report query, persisted snapshot, download, or generated file was validated. |

### Integration, security, performance and usability checks

All rows below are **NOT TESTED at runtime** unless marked otherwise. Static source review is not an executed security test.

| Check | Classification | Notes |
|---|---|---|
| Authentication for admin, merchandiser, supervisor and buyer | **NOT TESTED** | No test accounts/session credentials. |
| Database row-level security | **NOT TESTED** | Migration/schema reviewed; no requests issued under test roles. |
| Buyer isolation through direct API | **NOT TESTED** | Must attempt another buyer’s order, milestones, remarks and media paths with a buyer JWT. |
| Protected photo access | **NOT TESTED** | Static ownership/approval check reviewed; no signed URL or denial request executed. |
| Supabase RPC permissions | **NOT TESTED** | No role-based call tests; RPC migration not applied. |
| Edge Function authentication and CORS | **NOT TESTED** | Source reviewed for origin configuration and auth checks, but no OPTIONS/POST requests run. |
| Offline update persistence | **NOT TESTED** | No airplane-mode/browser storage test. |
| Duplicate sync prevention | **NOT TESTED** | Database uniqueness/idempotency was not exercised under retry. |
| Failed upload retry | **NOT TESTED** | No network interruption/upload failure test. |
| Tamil transcription and translation | **NOT TESTED** | Provider keys unavailable; no Tamil/audio sample sent. External provider use requires customer/factory approval. |
| Report downloads | **NOT TESTED** | PDF/XLSX files were not generated from an authenticated test workspace. |
| Low-end Android, slow network, photo performance, storage behaviour | **NOT TESTED** | No device or network profile available. |
| Mobile responsiveness | **NOT TESTED** | CSS/source was not treated as proof of mobile usability. |
| Bundle splitting | **PASS** | Production build generated separate React, Supabase and icon chunks; report libraries are lazy loaded. |

## Remaining defects and limitations

1. The production-plan save failure is still unverified; a real RPC response and test database schema are needed to isolate it.
2. All database, auth, RLS, Edge Function, storage, offline, retry, transcription, and download integration paths need execution in a disposable synthetic-data project.
3. Existing historical order release dates are estimated from `updated_at`; authoritative historical status snapshots are unavailable.
4. PDF/Excel files currently use current order progress/status and milestone state with historical production-update quantities. They are not a point-in-time reconstruction of every field.
5. The ExcelJS chunk is approximately 940 KB minified. It is lazy loaded but still needs testing over slow mobile connections; further splitting or a lighter export implementation may be warranted.
6. `.env.example` points to a hosted Supabase project. Its purpose was not verified during this task; treat it as untrusted until its owner confirms it is isolated.

## Security limitations

- Static policy/RPC review cannot establish deployed RLS state or actual project secrets.
- Buyer-isolation and storage-object access must be tested with separate buyer accounts and direct API calls.
- Edge Function CORS must be verified against the exact current browser origin; code defaults to the production origin if `APP_ORIGIN` is unset.
- AI transcription/translation sends issue text or audio to external providers when configured. Obtain approval for provider terms and data handling before enabling this workflow with factory/customer data.
- No service-role secret was read or used by this task. Keep it only in Supabase Edge Function secrets.

## Deployment and next verification steps

1. Create or identify a **disposable Supabase staging project** with synthetic-only data and confirm its project reference before connecting it.
2. Apply the initial schema and then `202611090001_stabilisation.sql` to that staging project. Review the release-date backfill caveat first.
3. Configure staging browser variables and Edge Function secrets listed above; set `APP_ORIGIN` to the exact staging web origin.
4. Deploy the four functions (`manage-users`, `approved-buyer-media`, `issue-assist`, `transcribe-issue`) to staging only.
5. Create synthetic users for all four roles and execute the full role/RLS/photo/RPC/CORS tests, the six must-have workflows, offline/retry tests, and report downloads.
6. Record actual responses and downloadable output evidence in a follow-up report. Fix any failures before production review.
7. Run `npm test` and `npm run build`; deploy only after staging acceptance and explicit production approval. No deployment or production data change was done in this task.

## P1 Core Product Validation — 2026-11-09

### Execution summary and blocker

The user specified that staging is available and authorized use of synthetic test data. However, this workspace has no `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ACCESS_TOKEN`, or `SUPABASE_SERVICE_ROLE_KEY` in its process environment; no `.env.local`/test environment file is present; and the Supabase CLI is unavailable. The only project URL/key found is in `.env.example`; the existing project documentation explicitly says its environment is not verified. It was therefore not used. No staging request, login, migration, seed, data write, Edge Function request, or browser workflow was executed.

**Result:** All staging acceptance items below are **NOT TESTED**, not PASS. This is an access/configuration blocker, not evidence that the feature failed. No feature fix was applied because no runtime failure or staging response was observed. To unblock, configure a confirmed disposable staging project URL and public anon key for this workspace, provide/use test account access for the four roles, and confirm staging has the migrations required by the current application. Keep service-role credentials server-side; they are not needed for ordinary browser tests. If test fixtures are not already available, authorize/prepare synthetic records in that staging project.

### Per-test records

For every record, **Actual result** means the observed execution result. Since these staging tests could not start, it is explicitly “not run,” rather than an inferred product outcome. Expected results restate the requested acceptance criteria.

| Test ID | Test steps | Expected result | Actual result | Status | Evidence / defect / fix |
|---|---|---|---|---|---|
| P1.1.a | Sign in as merchandiser; create an order using a staging buyer/unit; enter PO, style, colour, ex-factory date and size quantities; save as draft. | Valid draft is persisted with correct fields and size rows. | Not run; no staging URL/session available. | NOT TESTED | Evidence: environment availability check found no staging variables or Supabase CLI. Defect: none established. Fix: none. |
| P1.1.b | Enter size quantities whose sum differs from the entered PO total; submit. | Total is calculated from sizes; mismatch is surfaced clearly and requires the intended acknowledgement/handling. | Not run. | NOT TESTED | No staging form/RPC response. Defect/fix unknown. |
| P1.1.c | Create an order, then submit another order with the same buyer and PO. | Duplicate is rejected with a clear message; first order remains intact. | Not run. | NOT TESTED | Database uniqueness/RPC not exercised. Defect/fix unknown. |
| P1.2.a | Select an active TNA template for a draft order; generate milestones; compare each result with its configured date offset from ex-factory. | Dates match approved offsets and save with the plan. | Not run. | NOT TESTED | UTC date math has local unit coverage only; staging generation/save not exercised. Defect/fix unknown. |
| P1.2.b | Use date values near a month/year boundary and inspect in Asia/Kolkata; edit milestone dates before release and save. | No one-day timezone shift; accepted edits persist. | Not run. | NOT TESTED | No Asia/Kolkata browser/database round trip. Defect/fix unknown. |
| P1.2.c | Change milestone status through allowed states; set buyer visibility; inspect buyer view as the mapped buyer. | Status and visibility persist; buyer sees only milestones marked for buyer display. | Not run. | NOT TESTED | No live role sessions or RLS checks. Defect/fix unknown. |
| P1.3.a | Create a draft plan from an active stage-route template; set applicable stages. | Correct stages and sequence persist. | Not run. | NOT TESTED | Known production-plan save failure remains unresolved/unverified. No actual RPC error was captured. Defect/fix unknown. |
| P1.3.b | Assign two production lines and eligible supervisors to stages; save the plan. | Assignment configuration persists and validates against unit/stage. | Not run. | NOT TESTED | No plan save or database response. Defect/fix unknown. |
| P1.3.c | Release the planned order; sign in as assigned supervisor. | Released configuration remains fixed; assigned supervisor sees the assigned work only. | Not run. | NOT TESTED | Release locks, supervisor authorization and assignment query not executed. Defect/fix unknown. |
| P1.4.a | As assigned supervisor, submit daily quantity for a stage and line; verify saved row. | Period quantity, reporting date and timestamps are stored once and visible in history/aggregates. | Not run. | NOT TESTED | No supervisor session or staging write. Defect/fix unknown. |
| P1.4.b | Attach a photograph to an update; inspect administrator review and buyer state before/after approval. | Upload succeeds; photo is private until explicitly approved; approved access follows policy. | Not run. | NOT TESTED | Storage and signed media not exercised. Defect/fix unknown. |
| P1.4.c | Submit a text issue and a browser-recorded voice note. | Text/audio attach to the correct update; original audio is retained; no automatic transcription is implied. | Not run. | NOT TESTED | No browser/device/audio upload test. Defect/fix unknown. |
| P1.4.d | Submit zero output without and then with a reason; mark stage blocked without and then with explanation. | Invalid zero/blocked submissions are rejected clearly; valid ones persist with reason. | Not run. | NOT TESTED | Form and server validation not exercised. Defect/fix unknown. |
| P1.4.e | Inspect report date, client event time and server receipt time after submission and after offline retry. | Reporting date and timestamps are consistent and history is retained. | Not run. | NOT TESTED | No live row or offline sync. Defect/fix unknown. |
| P1.5.a | Configure two lines under the same stage; submit 100 on Line A and 150 on Line B for the same reporting period. | Stage total is 250; line records remain distinct; stage quantity is not counted again as a third submission. | Not run. | NOT TESTED | Aggregation SQL/RLS and UI not exercised. Defect/fix unknown. |
| P1.5.b | Resubmit using same client UUID after simulated retry; submit a distinct later-period update; use supported amendment flow if available. | Retry is idempotent; a new period is counted once; amendments preserve audit history and do not silently duplicate output. | Not run. | NOT TESTED | No sync retry or amendment workflow test. Existing docs state full amendment/history UI is incomplete. Defect: amendment path may be unavailable; no fix applied. |
| P1.5.c | Compare order-level progress with documented rule: output at the most advanced reported stage versus that stage target. | Progress reflects the documented stage/target rule and is not a sum of output across stages. | Not run. | NOT TESTED | Domain/UI behavior not exercised with live data. Defect/fix unknown. |
| P1.6.a | Seed only staging synthetic order: remaining 2,000, recent average 400/day, 4 working days left; inspect required pace. | Required pace is 500 pieces per working day. | Not run. | NOT TESTED | No staging order/calendar/update data. Defect/fix unknown. |
| P1.6.b | Configure only company-approved staging thresholds; inspect risk class and explanation for the sample. | Risk class follows the approved thresholds; explanation exposes pace/remaining days in understandable terms. | Not run. | NOT TESTED | No thresholds provided/configured. No thresholds were invented. Defect/fix unknown. |
| P1.6.c | Remove approved policy/calendar or insufficient production history; separately age the latest update beyond stale limit. | Missing/insufficient data is not green; stale status is separately identified from pace risk. | Not run. | NOT TESTED | No staging policy/calendar/history. Defect/fix unknown. |
| P1.7.a | Sign in as Buyer A; open released and shared order with approved milestones/photo and internal issue/unapproved photo. | Buyer A sees only own released/shared data, approved milestones/photos, and no internal issue/unapproved photo. | Not run. | NOT TESTED | No Buyer A credentials or staging records. Defect/fix unknown. |
| P1.7.b | As Buyer A, directly request Buyer B order, milestone and media identifiers through API/RPC/storage paths. | Every unauthorized record/media request is denied, not merely hidden in UI. | Not run. | NOT TESTED | No JWT/API session; RLS isolation remains unverified. Defect/fix unknown. |
| P1.8.a | Select Buyer A and a reporting week; generate and download PDF. | File downloads and contains only the selected buyer/week authorized fields. | Not run. | NOT TESTED | No signed-in report flow or file to inspect. Defect/fix unknown. |
| P1.8.b | Generate and download Excel for same buyer/week. | File downloads, opens, and contains expected buyer-safe rows/fields. | Not run. | NOT TESTED | No signed-in report flow or file to inspect. ExcelJS chunk is 940 KB minified in local build. Defect/fix unknown. |
| P1.8.c | Seed updates both inside and outside selected week; compare both exports, buyer identity and milestones; search exports for internal notes and Buyer B identifiers. | Only selected-week activity and Buyer A-authorized fields are present; no internal notes or other buyer data. | Not run. | NOT TESTED | Weekly-selection logic has unit tests, but no staging query/export/content inspection. Defect/fix unknown. |

### Local verification run during this P1 attempt

| Test | Result | Evidence / limitation |
|---|---|---|
| `npm test` | PASS | 3 domain tests passed: date-only offsets across calendar boundaries, invalid date/offset rejection, and selected-week report filtering/grouping. These do not test Supabase or end-to-end workflows. |
| `npm run build` | PASS | TypeScript and Vite build succeeded. Vite reports the lazy ExcelJS chunk is about 940 KB minified and above the 500 KB warning threshold. |

### Prioritised remaining P1 defects / blockers

1. **P1 blocker — Staging access unavailable here.** No confirmed staging URL/key, role test sessions, or CLI are configured. Provide the staging URL and browser-safe anon key through the workspace's approved secret mechanism, plus test account access (or a way to create accounts in staging). Do not send the service-role key in chat or browser configuration.
2. **P1 defect — Plan save failure unresolved.** Reproduce against staging and capture the actual `save_order_plan` RPC error before changing schema/client logic.
3. **P1 validation gap — Database and authorization behaviors.** Duplicate PO, release locks, supervisor assignment scoping, line aggregation/idempotency, buyer isolation, photo approval, and RLS/RPC permissions require direct staging tests.
4. **P1 validation gap — Exports.** Download and inspect real PDF/XLSX outputs for selected-week correctness and buyer-data exclusion. Consider ExcelJS mobile download impact after measuring; do not optimize unrelated behavior before acceptance evidence.
5. **P1 validation gap — Device workflows.** Photo/audio capture, offline persistence/retry, timestamps and responsive layout require target mobile/browser testing.

**P2 gate:** P1 has not passed and is not ready to move to P2. No P2 work was started. Resume P1 when confirmed staging access and synthetic role accounts are available; request approval to enter P2 only after the P1 tests have actual results and the remaining defects are explicitly reviewed.

## Follow-up: profile and password-change request feature

After the original QA report, a role-independent **My profile** page was added. It shows the signed-in account name, email, role and buyer account (for buyer users). Users can submit one pending password-change request at a time, with an optional note. Requests create an in-app admin alert: a pending-count badge appears on User management and the request is listed there. The badge refreshes every 30 seconds while an admin is signed in.

An administrator can open a request, which selects that user in the existing User management form. The admin enters a new temporary password; the existing authenticated Edge Function performs the Auth password reset. After that succeeds, the app marks the request completed and records reviewer/time. The administrator must share the temporary password securely with the user. No email or push notification service is configured; the alert is inside Threadline.

This feature requires `supabase/migrations/202611090002_password_change_requests.sql`. It is separate from the earlier stabilisation migration: if `202611090001_stabilisation.sql` was already applied, apply only migration `202611090002_password_change_requests.sql` for this feature. Neither migration was applied or tested against Supabase in this workspace. The current frontend build passed with the profile changes, and the existing 3 domain tests passed; the new authenticated request/reset flow itself remains **NOT TESTED** without a disposable Supabase test project.

## Follow-up: administrator configuration editing and release locks

At that point, workspace setup had a directory for buyer accounts, production units, production lines, stage/TNA templates, unit holidays, and risk policies. Later role ownership moved those operational settings to merchandisers; the records used by released or completed orders remain locked, and used stage/TNA templates can be copied into a new version for future orders. Editing risk thresholds clears prior approval and requires a new explicit approval.

Migration `202611090003_release_configuration_locks.sql` adds database triggers that enforce these locks even through direct table requests. It also blocks edits to released order fields, sizes, production stages, stage assignments, supervisors, and milestone plan details; milestone status-only changes remain allowed. This is code-reviewed but unexecuted SQL because no isolated Supabase project is configured. **The application build passed** after these changes; the three existing domain tests also pass, but edit, lock, and direct-API enforcement remain **NOT TESTED** against a database.

Migration order: apply the initial schema, then `202611090001_stabilisation.sql` if it has not already been applied, then `202611090002_password_change_requests.sql` and `202611090003_release_configuration_locks.sql`. Do not rerun an already-applied migration; each is a one-time migration. The lock behavior freezes the shared unit calendar and risk policy after a released order uses that unit. To use changed shared settings for future production while preserving released order history, create a separate production unit configuration.

## Role ownership and plan validation update — 2026-11-09

Product-owner direction moved operational setup and order work to the merchandiser role. Merchandisers own buyers, units/calendars, lines, stage/TNA templates, holidays, approved risk policies, order planning/release, issue/photo review, and reports. Administrators own account provisioning, role/activity/email/password management, buyer-user mapping, password-change requests, and their own profile. The UI now places Order setup under merchandisers and sends administrators to User management; operational screens, dialogs, and milestone edits are guarded by role.

The plan editor now checks stage-to-TNA milestone links before save and identifies the stage, linked milestone, selected TNA template, and correction. The new RPC implementation in migration `202611090004_merchandiser_workspace_authority.sql` returns the same specific error for stale/direct requests. That migration moves workspace/order RLS permissions and order RPC authority to merchandisers, and keeps profile and buyer-mapping mutations behind the authenticated `manage-users` Edge Function. `issue-assist` and `transcribe-issue` now reject administrator callers; redeploy these two functions with the source changes.

**Local checks after the changes:** `npm test` passed (4 domain tests, including case-insensitive stage/milestone mismatch identification); `npm run build` passed (TypeScript/Vite). **Staging verification:** NOT TESTED. Migration 004 was not executed and Edge Functions were not deployed/called because a confirmed staging connection is not configured in this checkout. Validate merchandiser setup/order workflows, administrator denials, user management, and both client/RPC stage-milestone errors before relying on the permission change. This new role split is not yet staging-verified. The existing ExcelJS chunk warning remains (about 940 KB minified).

## Order setup directory UI update — 2026-11-09

Renamed the merchandiser page/navigation label to **Order setup**. Moved the existing-settings directory directly below its summary cards, ahead of the creation forms, so existing records are reachable immediately. The directory now has search, editable/locked filters, category counts, collapsible groups, clearer state badges, readable weekday names, human-readable TNA offsets, and risk-policy details. Locked template rows still offer **New version** while preserving the prior version; other locked records remain visible but read-only. The user-account notice now correctly directs merchandisers to their administrator.

This is a frontend presentation/update only; no new migration is required. **Local verification:** `npm test` PASS (4 tests) and `npm run build` PASS. The build still warns that the lazy ExcelJS chunk is about 940 KB minified. The new layout was not exercised in a browser/device session, so responsive visual QA remains NOT TESTED.
