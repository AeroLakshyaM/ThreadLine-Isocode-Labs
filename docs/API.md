# API and database interface

Threadline uses Supabase PostgREST, Auth, Storage and Edge Functions. The browser sends the signed-in user's access token; RLS is the authorization boundary. Do not use a service-role key in a browser.

## Database RPCs

| RPC | Allowed caller | Purpose |
|---|---|---|
| `create_order_draft(buyer_id_input, unit_id_input, po_number_input, style_input, colour_input, ex_factory_date_input, stated_total_input, sizes_input, mismatch_acknowledged_input)` | Merchandiser/Admin | Validates and creates a draft; Postgres calculates total from the size rows. |
| `save_order_plan(order_id_input, stage_template_id_input, tna_template_id_input, stages_input, milestones_input, release_input)` | Merchandiser/Admin | Verifies the selected templates and active supervisors, writes route/milestones, and optionally releases. |
| `get_buyer_order_progress(target_order)` | Buyer mapped to the order's buyer | Returns approved progress, buyer-visible milestones, and approved remarks only. |
| `get_buyer_approved_photo_paths(target_order)` | Buyer mapped to the order's buyer | Returns paths only for approved buyer photos. |
| `buyer_can_view_approved_photo(target_order, target_path)` | Buyer mapped to the order's buyer | Verifies ownership and approval before the media function signs a URL. |

## Tables used by the client

- `profiles`, `buyers`, `buyer_user_access`, `production_units`, `production_lines` support role/account setup.
- `stage_templates`, `stage_template_steps`, `tna_templates`, `tna_template_milestones` are admin-managed templates.
- `purchase_orders`, `order_sizes`, `order_stages`, `stage_line_assignments`, `stage_submitters`, `order_milestones` store order setup and route.
- `production_updates` is append-only and uses a unique `client_id`; `production_amendments` records corrections.
- `issue_reviews`, `photo_approvals`, `recovery_actions`, `risk_configuration`, `unit_holidays`, `audit_log`, and `weekly_reports` hold review/configuration history.

## Edge Functions

All functions accept POST and an authenticated Supabase JWT. Configure `APP_ORIGIN` to the exact browser origin.

- `issue-assist`: `{ transcript, sourceLanguage?, targetLanguage? }` → `{ translation, category, provider, needsHumanReview }`. Calls Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`) first, then Gemini 3 Flash Preview (`gemini-3-flash-preview`) if configured and the first call fails. Model IDs can be overridden with `NVIDIA_MODEL` and `GEMINI_MODEL` Edge Function secrets. Returns 503 without a provider key; never changes operational records.
- `transcribe-issue`: `{ updateId }` → `{ transcript, language, provider, needsHumanReview }`. Checks reviewer role, retrieves original audio from private storage and asks Gemini 3 Flash Preview (`gemini-3-flash-preview`) for a verbatim transcript. The `GEMINI_TRANSCRIBE_MODEL` Edge Function secret can override the model. Original audio is not overwritten.
- `approved-buyer-media`: `{ orderId, path }` → `{ url, expiresInSeconds }`. Buyer role, buyer ownership, order visibility and explicit photo approval are checked before creating a short-lived signed URL.

## Offline production update contract

An IndexedDB queue record contains `clientId`, `orderId`, `stageId`, optional `lineId`, `reportingDate`, period `quantity`, optional `zeroReason`, issue text and capture time. Media is uploaded to `production-evidence/{orderId}/{clientId}.{ext}`. The client upserts by `client_id` with duplicate-ignore semantics. Queue items are deleted only after the production update request succeeds. A failed media upload or row write leaves the local record for retry.

## Schema constraints and permissions

The SQL migration defines foreign keys, non-negative quantity checks, buyer + normalized PO uniqueness, unique size labels per PO, unique line per stage, unique stage/milestone sequence per PO, immutable update policies and role-specific RLS. Test those policies on a disposable Supabase project before a production rollout.
