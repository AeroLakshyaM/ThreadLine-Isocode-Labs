# Threadline stabilisation and QA report

**Prepared:** 2026-11-09
**Repository:** `D:\Threadline - Isocode Labs\ThreadLine-Isocode-Labs`
**Scope:** Targeted stabilisation of the existing React/Vite/Supabase implementation. No redesign or production deployment was performed.

## Executive status

Local TypeScript compilation, Vite production bundling, and three focused domain tests pass. The changes address the known frontend defects and add a migration for schema changes. The connected Supabase environment could not be safely identified as an isolated test project: no local test credentials, Supabase CLI, or disposable project configuration were available. No database migration, seed data, authentication request, Edge Function call, or production write was run. Consequently, the application is **not yet demonstrably verified end to end**, and live/database-dependent requirements remain partial or not tested.

## Prioritised remediation performed

1. **P0 — Protect data:** verified that no isolated Supabase test credentials or CLI are configured; did not call the hosted URL shown in `.env.example` because its environment is unconfirmed.
2. **P1 — Correct data contracts and dates:** included email in managed-user update requests; switched TNA offset arithmetic to UTC date-only operations; clarified buyer progress as cumulative output for the most advanced stage and its stage target.
3. **P1 — Complete workflows:** added editable milestone states and recovery-action creation/status updates; changed weekly reports to load activity for the selected week, group output by stage, persist a report snapshot, and disclose which fields are current-at-export versus historical-by-reporting-date.
4. **P2 — Local verification:** added domain tests and Vite chunk splitting; ran the build and test suite.
5. **P0 — External verification gate remains:** live integration, security, offline, device, and export-download testing still needs a separate synthetic-data Supabase project.

## Issues identified and changes made

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
