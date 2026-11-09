-- Deletes all Threadline operational data for a clean handoff.
-- It preserves every profile and Supabase Auth user.
-- Run only after confirming that the workspace data has been backed up or is
-- no longer needed. This cannot be undone.
begin;

alter table public.buyers disable trigger buyers_release_lock;
alter table public.production_units disable trigger units_release_lock;
alter table public.production_lines disable trigger lines_release_lock;
alter table public.stage_templates disable trigger stage_templates_release_lock;
alter table public.stage_template_steps disable trigger stage_steps_release_lock;
alter table public.tna_templates disable trigger tna_templates_release_lock;
alter table public.tna_template_milestones disable trigger tna_steps_release_lock;
alter table public.unit_holidays disable trigger holidays_release_lock;
alter table public.risk_configuration disable trigger risk_policy_release_lock;
alter table public.order_sizes disable trigger released_sizes_freeze;
alter table public.order_sizes disable trigger order_size_refresh;
alter table public.order_stages disable trigger released_stages_freeze;
alter table public.stage_line_assignments disable trigger released_lines_freeze;
alter table public.stage_submitters disable trigger released_submitters_freeze;
alter table public.order_milestones disable trigger released_milestones_freeze;

delete from public.production_amendments;
delete from public.issue_reviews;
delete from public.photo_approvals;
delete from public.production_updates;
delete from public.recovery_actions;
delete from public.weekly_reports;
delete from public.order_milestones;
delete from public.stage_line_assignments;
delete from public.stage_submitters;
delete from public.order_stages;
delete from public.order_sizes;
delete from public.purchase_orders;

delete from public.buyer_user_access;
delete from public.unit_holidays;
delete from public.risk_configuration;
delete from public.stage_templates;
delete from public.tna_templates;
delete from public.production_lines;
delete from public.production_units;
delete from public.buyers;
delete from public.audit_log;
delete from public.password_change_requests;

alter table public.buyers enable trigger buyers_release_lock;
alter table public.production_units enable trigger units_release_lock;
alter table public.production_lines enable trigger lines_release_lock;
alter table public.stage_templates enable trigger stage_templates_release_lock;
alter table public.stage_template_steps enable trigger stage_steps_release_lock;
alter table public.tna_templates enable trigger tna_templates_release_lock;
alter table public.tna_template_milestones enable trigger tna_steps_release_lock;
alter table public.unit_holidays enable trigger holidays_release_lock;
alter table public.risk_configuration enable trigger risk_policy_release_lock;
alter table public.order_sizes enable trigger released_sizes_freeze;
alter table public.order_sizes enable trigger order_size_refresh;
alter table public.order_stages enable trigger released_stages_freeze;
alter table public.stage_line_assignments enable trigger released_lines_freeze;
alter table public.stage_submitters enable trigger released_submitters_freeze;
alter table public.order_milestones enable trigger released_milestones_freeze;

commit;
