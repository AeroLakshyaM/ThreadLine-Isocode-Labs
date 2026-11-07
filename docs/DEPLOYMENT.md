# Deployment and environment guide

## Required setup

- Supabase project URL and public anon key for the browser.
- Supabase Auth user records and matching `profiles` rows. Create the first admin profile using trusted SQL/dashboard access.
- Edge Function secrets: `APP_ORIGIN=https://threadline-ruddy.vercel.app`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. `APP_ORIGIN` must be the website origin only (scheme + host, no path or trailing slash); the functions use the ThreadLine production origin as a fallback.
- Optional AI secrets after customer consent: `NVIDIA_API_KEY` and `GEMINI_API_KEY`. Defaults: `NVIDIA_MODEL=nvidia/nemotron-3-ultra-550b-a55b` for first-choice issue translation/category suggestions; `GEMINI_MODEL=gemini-3-flash-preview` for fallback suggestions; and `GEMINI_TRANSCRIBE_MODEL=gemini-3-flash-preview` for human-triggered audio transcription. Model names are configurable as Edge Function secrets. See NVIDIA's [Nemotron 3 Ultra model page](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b) and Google's [Gemini 3 Flash Preview model page](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview).
- Static web hosting with HTTPS, SPA route fallback and a domain matching `APP_ORIGIN`.

## Release steps

1. Create a staging Supabase project and a separate production project.
2. Review and apply the migration to staging. Never apply the synthetic seed to production.
3. After the initial administrator is provisioned, use ThreadLine to create buyer, unit, calendar, stage template, TNA template, production line, risk policy and user records from approved customer information.
4. Verify buyer ownership, supervisor stage assignments, RLS, private bucket policies and signed URL expiry with separate test accounts.
5. Configure Edge Function secrets in the Supabase project and deploy `issue-assist`, `transcribe-issue`, `approved-buyer-media`, and `manage-users`. The `manage-users` function needs `SUPABASE_SERVICE_ROLE_KEY` and verifies the caller's active administrator profile before it uses the admin Auth API. Keep provider/service keys outside frontend hosting variables.
6. Build with `npm run build`, deploy the `dist/` folder, and set the Vite `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` build variables.
7. Test offline queueing, reconnect and retry on the target low-end Android devices. Verify updates are still present after a reload and verify server receipt times.
8. Configure database backups, log monitoring, retention, access review, incident owner and restore procedure with the hosting/project owner. These controls are not configured by this repository.

## Secrets

`.env.example` contains browser-safe variable names. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` belong in the client build. The Supabase service-role key and NVIDIA/Gemini keys must be Edge Function secrets. Rotate any secret that has been exposed in a browser bundle, screenshot, chat or source repository. After the first administrator is provisioned, user accounts, roles, passwords and buyer-user mapping can be managed in ThreadLine's **User management** page. The first administrator, project keys, schema migrations and function deployments still require trusted project setup.

## Free-tier and cost note

NVIDIA offers a free endpoint for [Nemotron 3 Ultra](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b). Google documents a Gemini free tier for limited model access and states that free-tier content may be used to improve products. Review [Gemini API pricing and data-use terms](https://ai.google.dev/gemini-api/docs/pricing) before enabling AI. Supabase currently lists limited Free-plan quotas and says inactive free projects may pause; see [current Supabase billing limits](https://supabase.com/docs/guides/platform/billing-on-supabase). Free access has quotas and terms; the app is not guaranteed to run at zero cost. Storage, database, egress, hosting, model/API allowances and request limits can change. Do not send sensitive factory data or recordings to a provider without customer/factory approval of the data handling.
