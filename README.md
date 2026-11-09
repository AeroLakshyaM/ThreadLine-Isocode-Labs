# Threadline

Threadline is a mobile-first production order tracking PWA for garment manufacturing teams. The app uses React + Vite, Supabase Auth/Postgres/Storage/Edge Functions, and IndexedDB for pending offline production entries.

## Current project status

This is an implementation foundation with working screens and backend flows, not a production deployment. It has a synthetic preview mode, live Supabase login/data paths, draft PO creation, order planning and release, offline queueing, issue review, photo approval, buyer-scoped reads, basic workspace setup and PDF/XLSX snapshot exports. User provisioning/buyer mapping and company data must still be completed; several workflows need real-project integration and field testing before production use. See `docs/OPEN_DECISIONS.md` and `docs/KNOWN_LIMITATIONS.md`.

The product owner's PM-deal assessment brief and judging rubric are preserved in `docs/ASSESSMENT_BRIEF.md`. Treat it as assessment context for future PRD/timeline/agreement work; it does not by itself authorize external submission.

Never use preview data as factory data. The demo seed creates synthetic names and inactive example templates only; it sets no working calendar, risk thresholds, or Company A facts.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local` and set the public Supabase project URL and anon key. Without them, the app opens a clearly labelled synthetic preview.
3. Run `npm install`, then `npm run dev`.
4. For a production bundle, run `npm run build`; serve `dist/` from an HTTPS static host with SPA fallback to `index.html`.

## Supabase setup

1. Create a Supabase project and keep its service-role key private.
2. Apply `supabase/migrations/202611050001_initial_schema.sql` to a new project using the Supabase CLI or SQL editor.
3. Apply `supabase/seed.sql` only in a development project. The values are synthetic and templates are inactive.
4. Create the initial administrator in Supabase Auth and provision its first `profiles` row as `admin` using trusted project setup. After that, manage accounts, roles, passwords and buyer access from ThreadLine's User management page.
5. Configure `APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as Edge Function secrets. Set `APP_ORIGIN` to the exact deployed origin; never use a service-role key in frontend variables.
6. Set AI secrets only after the customer approves provider data handling and usage: `NVIDIA_API_KEY` (optional `NVIDIA_MODEL`, default `nvidia/nemotron-3-ultra-550b-a55b`) and `GEMINI_API_KEY` (optional `GEMINI_MODEL`, `GEMINI_TRANSCRIBE_MODEL`, and `GEMINI_ADVISOR_MODEL`, defaulting to `gemini-3-flash-preview`). Gemini handles human-triggered voice transcription and on-request order advice. The advisor receives order progress, stage forecasts, milestones, and the supervisor's issue note.
7. Deploy `issue-assist`, `transcribe-issue`, `order-advisor`, `approved-buyer-media`, and `manage-users`. Provider keys are server-side only. Functions fail clearly if keys are absent; AI is not simulated.
8. Add company buyer/unit/line records, user assignments, approved stage and TNA templates, calendars, holidays, risk policy and retention policy before releasing live orders.

For a clean handoff, run `supabase/reset_workspace_data.sql` in the Supabase
SQL editor. It permanently removes all operational workspace data and
production evidence while preserving profiles and Supabase Auth users. Back up
anything needed before running it.

NVIDIA lists a free endpoint for [Nemotron 3 Ultra](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b). [Gemini 3 Flash Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview) accepts audio input; Google states Gemini free-tier content may be used to improve its products. Review [Gemini pricing and data-use terms](https://ai.google.dev/gemini-api/docs/pricing) before enabling AI. Quotas, model availability and terms can change, so zero ongoing cost is not guaranteed. Do not send factory data or audio to a provider until the factory/customer has approved that data handling and the Tamil workflow has been piloted.

## Important operational rules

- Draft orders are created through a server-side RPC that derives order quantity from the size matrix.
- Plans can be released only after authorised templates, milestones and stage supervisors have been selected. Working line assignments are optional per stage.
- Production quantities are period output. Cumulative totals are calculated from immutable update rows.
- Risk values stay `insufficient` until a non-provisional risk policy and working calendar are approved. The provisional sample thresholds in preview are not company policy.
- Offline updates use client UUIDs and idempotent upserts. The queue is stored in this browser profile; clearing site data can remove unsynced entries. Photo/audio uploads and queue behavior must be exercised on target Android devices before launch.
- Buyer data is scoped by database policies and buyer-specific functions. Do not weaken RLS to solve UI access problems.
- AI output is advisory and requires human review. The original recording remains separate from transcript and translation.

## Project map

- `src/`: React application, role-based screens, PWA queue, Supabase data access.
- `supabase/migrations/`: schema, constraints, RLS, secure RPCs and private evidence bucket.
- `supabase/functions/`: provider-backed issue assist, transcription and approved media URLs.
- `docs/`: architecture, workflow/API notes, decisions and limitations.
