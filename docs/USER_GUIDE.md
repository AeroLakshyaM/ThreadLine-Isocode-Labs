# User guide

## Merchandiser

1. Sign in using an administrator-provisioned account.
2. Review the order board. Filters are based on buyers, units and order search; insufficient data stays visible when calendars, approved risk settings or production history are missing.
3. Create a draft with buyer, production unit, PO, style, colour, ex-factory date and size-wise quantities. Review any PO total mismatch.
4. Open the draft and select an active production route and TNA template. Confirm each stage, stage target, line assignments, supervisor assignments, milestone dates and buyer visibility. Save as draft or release.
5. Review internal issue notes. AI transcription/translation are optional suggestions. Correct and approve them yourself; buyer-safe remarks require separate approval.
6. Generate a weekly PDF or Excel snapshot for a selected buyer and week. These exports include only released/completed orders and buyer-visible milestones. No unapproved issue or photo data is included.

## Factory supervisor

1. Sign in using the account assigned to your stage.
2. Choose the order, stage and (where assigned) line.
3. Enter output for this reporting period only. Enter `0` and explain why when no pieces were produced.
4. Add a short issue note, record a voice note or attach a supporting photo if needed.
5. Save the update. It is first stored locally. Check the pending sync screen and retry after the connection returns. Do not clear browser data while updates are pending.

## Buyer

Sign in with your buyer account. The portal is read-only and shows only orders released and shared by the merchandiser. Progress, visible milestones, approved remarks and explicitly approved photos are shown when available. Internal factory issues and unapproved photos are excluded.

## Administrator

Use Workspace setup to add confirmed buyers, units and working days, production lines, stage/TNA templates, holidays and company-approved unit risk policies. Templates are activated only after the administrator checks the approval box; risk policies require an authorised approver. User provisioning and buyer-user mapping are still managed through trusted Supabase administration. Never activate an illustrative route or invent a company threshold.
