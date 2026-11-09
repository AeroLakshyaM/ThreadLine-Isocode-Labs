# Requirement traceability

Status describes the repository at this handoff. A working build is not the same as an accepted production workflow.

| Requirement | Implementation location | Status |
|---|---|---|
| Order Setup: buyer/unit/PO/style/colour/date/size matrix, calculated totals and mismatch acknowledgement | `src/App.tsx`, `create_order_draft`, `purchase_orders`, `order_sizes` | Partial: draft creation and server validation are wired; backend behavior not integration-tested. |
| Duplicate PO detection by buyer | normalized unique index in migration; order modal error mapping | Implemented in schema/client path; migration not applied or verified against a running database. |
| Configurable stages, order route, applicable stages, lines and submitters | template tables, `save_order_plan`, PlanModal, Order setup | Partial: merchandiser creates/toggles templates and plans an order; no arbitrary step editing/reordering. Migration `202611090004_merchandiser_workspace_authority.sql` must be applied before live role permissions match. |
| TNA template generation and reviewed dates | TNA template tables, PlanModal, `save_order_plan` | Partial: uses selected templates and lets merchandiser adjust dates before release; no real Company A template provided. |
| Supervisor mobile daily update, period quantity, optional photo and issue note | `ProductionPage`, `UpdateModal`, `offline.ts`, `production_updates` | Partial: UI/queue/DB paths exist; live storage and RLS not exercised. |
| Tamil supervisor interface for floor updates | `ProductionPage`, `UpdateModal`, `VoiceNoteCapture` | Partial: local English/Tamil switch now covers the supervisor dashboard and core update form, with device-local preference. Tamil copy/device rendering and full application localization have not been field-tested. |
| Line output aggregates into stage/order totals without duplicate stage-total entry | line assignments, stage aggregation, line-vs-stage RLS condition and unique period index | Partial: implemented in schema and UI; require Supabase integration validation. |
| Zero output vs missing/stale/blocked/incomplete reporting | zero reason field, freshness, risk and issue surfaces | Partial: zero requires a reason; issue and freshness labels exist; incomplete and blocked states are not comprehensively modelled. |
| Order monitoring board, filters and risk explanation | BoardPage, OrderDrawer, `liveData.ts` | Partial: buyer/unit/ship-week filters; deterministic risk remains insufficient without approved settings. No realtime refresh. |
| Transparent delay calculation and configurable approved thresholds | `liveData.ts`, `risk_configuration`, `unit_holidays` | Partial: calculation implemented; merchandiser workspace UI captures authorized approval; no customer thresholds/calendar configured. |
| Buyer read-only portal and backend isolation | `BuyerPage`, buyer RPCs, RLS policies | Partial: buyer-scoped query/functions/policies coded; no two-account security test has run. |
| Merchandiser-confirmed buyer delay warning | `IssueReviewModal`, buyer-safe remarks, buyer portal | Partial/gap: merchandisers can approve separate buyer-safe remarks, but there is no explicit workflow that binds a calculated risk warning to a review/confirmation and then publishes that warning to the buyer. |
| Approved media access | private bucket, approval trigger/table, photo approval screen, signed URL Edge Function | Partial: approval and buyer display path exist; nested query, storage policies and signed URLs have not been integration-tested. |
| Buyer-specific weekly PDF/Excel | `ReportsPage`, `weekly_reports`, jsPDF, ExcelJS | Partial: exports from buyer-safe order snapshot and buyer-visible milestones; approved photos/remarks are omitted and no archived file is stored. |
| Tamil audio retention, transcript, translation and human review | `UpdateModal`, issue review UI, `transcribe-issue`, `issue-assist` | Partial: integration code and review UI exist; provider keys, recording tests, actual Tamil accuracy and data-use approval are missing. |
| Offline queue, UUID idempotency and retry | PWA service worker, IndexedDB `offline.ts`, `client_id` | Partial: implemented; no device/browser field test, real sync test or partial upload recovery test. |
| Audit history and corrections | audit triggers, append-only update rows, amendments table | Partial: database foundation exists; amendment workflow/history screen missing. |
| Roles and account isolation | Supabase Auth, profiles, RLS | Partial: sign-in and RLS are coded; administrator manages user accounts only and merchandisers manage operational workspace/order data. Migration `202611090004_merchandiser_workspace_authority.sql` and adversarial tests remain required. |
| Deployment, monitoring, backups and documentation | `docs/DEPLOYMENT.md`, `.env.example` | Partial: deployment guidance provided; no project has been deployed and operational monitoring/backup is not configured. |

## Factory interview insights applied

The workflow specification records observations from Aadiba Manufacturers. These are treated as workflow research, not as confirmation that Aadiba is Company A. The implementation prioritises quick supervisor capture, phone-first controls, Tamil voice-note preservation and human review, offline queueing, stage/line flexibility, early visibility of risk, and buyer-safe updates. No factory interview observation has been converted into an assumed Company A calendar, threshold, TNA template or buyer policy.

## Scope exclusions carried through

Costing, invoicing, export documentation, fabric inventory/procurement, attendance, payroll, HR, full ERP functionality, autonomous AI production decisions and unapproved automatic buyer communication are out of scope.
