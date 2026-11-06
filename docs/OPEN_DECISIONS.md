# Open decisions and assumptions

## Pending customer decisions

1. Company A identity, buyer list, production-unit list and real account/user owners. Interview information in the workflow specification refers to Aadiba Manufacturers; it is not evidence that Aadiba is Company A.
2. Approved production-stage routes by garment/style and which stages require a line assignment versus stage-total reporting.
3. Company TNA templates, milestone owners, buyer visibility, date offsets and rules for changing dates after release.
4. Unit working days, holidays, local timezone and reporting cut-off time.
5. Green/amber/red thresholds, recent-output window, stale-update threshold, and authorised approver. No production risk policy is seeded.
6. Supervisor assignment rules, whether multiple submitters are allowed, and the roles allowed to release a PO.
7. Photo approval owner, retention period, buyer display rules and export handling.
8. Tamil audio consent, approved AI providers, data-use terms, target recording devices, expected languages and acceptable transcription quality. No representative factory recordings have been evaluated. Gemini's free tier may use submitted content to improve products; obtain explicit customer approval or use an approved paid/alternative processing path before sending sensitive recordings.
9. Whether AI providers may process identifiable customer/order details; whether text/audio must be redacted first.
10. Buyer report branding, week boundaries, language, inclusion of approved photos, remarks, and secure archive/retention expectations.
11. Hosting region, backup retention, disaster recovery target, user provisioning policy and account recovery process.
12. Target low-end Android models, browser versions, photo/audio size limits, and support for voice recording when offline.
13. Whether reports must be generated server-side and archived, and whether reports should cover daily updates within the reporting week or a point-in-time order snapshot.
14. Project cap and six-week plan remain constraints from the supplied assignment; customer scope, acceptance owner and deployment date are not confirmed.

## Reversible assumptions currently used

- React + Vite PWA with Supabase Auth, Postgres/RLS, private Storage and Edge Functions.
- Asia/Kolkata timezone for illustrative seed records, not as a claim about Company A's configured calendar.
- Gemini is the human-triggered Tamil audio transcription provider; Nemotron is the first text-translation/category suggestion provider with Gemini fallback.
- PDF and Excel are built in the signed-in browser using the already-authorised order snapshot; no buyer-internal issue notes are included.
- Production update quantity is a reporting-period amount, not a cumulative value. Updates are append-only and use UUID idempotency.
- Preview records and template examples are synthetic, are not live data, and are excluded from sync and report exports.

## Blockers to production launch

Company identity/data, approved route/TNA templates, calendars and risk thresholds, provider consent/credentials, buyer and supervisor provisioning, photo-approval workflow, and on-device offline/audio testing are required before production use.
