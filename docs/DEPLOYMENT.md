# Deployment and environment guide

## Required setup

- Supabase project URL and public anon key for the browser.
- Supabase Auth user records and matching `profiles` rows. Create the first admin profile using trusted SQL/dashboard access.
- Edge Function secrets: `APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Optional AI secrets after customer consent: `NVIDIA_API_KEY`, `GEMINI_API_KEY`. The default text suggestion model is `nvidia/nemotron-3.5-lightning-30b-a3b`; NVIDIA currently lists a free API endpoint and a 1M context window on its [model page](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b). Model names are configurable in Edge Function secrets.
- Static web hosting with HTTPS, SPA route fallback and a domain matching `APP_ORIGIN`.

## Release steps

1. Create a staging Supabase project and a separate production project.
2. Review and apply the migration to staging. Never apply the synthetic seed to production.
3. Create buyer, unit, calendar, stage template, TNA template, production line, risk policy and user records using approved customer information.
4. Verify buyer ownership, supervisor stage assignments, RLS, private bucket policies and signed URL expiry with separate test accounts.
5. Configure Edge Function secrets in the Supabase project and deploy each function. Keep provider/service keys outside frontend hosting variables.
6. Build with `npm run build`, deploy the `dist/` folder, and set the Vite `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` build variables.
7. Test offline queueing, reconnect and retry on the target low-end Android devices. Verify updates are still present after a reload and verify server receipt times.
8. Configure database backups, log monitoring, retention, access review, incident owner and restore procedure with the hosting/project owner. These controls are not configured by this repository.

## Secrets

`.env.example` contains browser-safe variable names and commented examples. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` belong in the client build. The Supabase service-role key and NVIDIA/Gemini keys must be Edge Function secrets. Rotate any secret that has been exposed in a browser bundle, screenshot, chat or source repository.

## Free-tier and cost note

NVIDIA lists a free endpoint for this Nemotron model. Google documents a Gemini free tier for limited model access, but also says content submitted on the free tier may be used to improve products. Review [NVIDIA's model page](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b) and [Gemini API pricing/data-use terms](https://ai.google.dev/gemini-api/docs/pricing) before enabling AI. Supabase currently lists limited Free-plan quotas and says inactive free projects may pause; see [current Supabase billing limits](https://supabase.com/docs/guides/platform/billing-on-supabase). Free access has quotas and terms; the app is not guaranteed to run at zero cost. Storage, database, egress, hosting, model/API allowances and request limits can change. Do not send sensitive factory recordings to a free-tier provider without customer/factory approval of the data handling.
