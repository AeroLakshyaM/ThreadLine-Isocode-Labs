-- Freeze workspace configuration used by released production plans.
-- Apply after the initial schema and before relying on admin edit controls.

create or replace function public.guard_released_workspace_configuration()
returns trigger language plpgsql set search_path=public as $$
declare record_id uuid; parent_id uuid; unit_key uuid; row_data jsonb;
begin
  if tg_op='DELETE' then row_data:=to_jsonb(old); else row_data:=to_jsonb(new); end if;
  record_id := coalesce(row_data->>'id', row_data->>'template_id', row_data->>'unit_id')::uuid;
  if tg_table_name='buyers' and exists(select 1 from public.purchase_orders p where p.buyer_id=record_id and p.state in ('released','complete')) then
    raise exception 'This buyer is locked because a production plan has been released. Create another buyer account for future orders.' using errcode='55000';
  elsif tg_table_name='production_units' and exists(select 1 from public.purchase_orders p where p.unit_id=record_id and p.state in ('released','complete')) then
    raise exception 'This production unit is locked because a production plan has been released. Create another unit for future orders.' using errcode='55000';
  elsif tg_table_name='production_lines' and (exists(select 1 from public.stage_line_assignments a join public.order_stages s on s.id=a.stage_id join public.purchase_orders p on p.id=s.order_id where a.line_id=record_id and p.state in ('released','complete')) or exists(select 1 from public.production_updates u where u.line_id=record_id)) then
    raise exception 'This production line is already used by a released plan or production update.' using errcode='55000';
  elsif tg_table_name='stage_templates' and exists(select 1 from public.purchase_orders p where p.stage_template_id=record_id and p.state in ('released','complete')) then
    raise exception 'This stage template is locked because a production plan has been released.' using errcode='55000';
  elsif tg_table_name='tna_templates' and exists(select 1 from public.purchase_orders p where p.tna_template_id=record_id and p.state in ('released','complete')) then
    raise exception 'This TNA template is locked because a production plan has been released.' using errcode='55000';
  elsif tg_table_name='stage_template_steps' then
    if tg_op<>'INSERT' then parent_id := (to_jsonb(old)->>'template_id')::uuid; if exists(select 1 from public.purchase_orders p where p.stage_template_id=parent_id and p.state in ('released','complete')) then raise exception 'Stages in a template used by a released plan are locked.' using errcode='55000'; end if; end if;
    if tg_op<>'DELETE' then parent_id := (to_jsonb(new)->>'template_id')::uuid; if exists(select 1 from public.purchase_orders p where p.stage_template_id=parent_id and p.state in ('released','complete')) then raise exception 'Stages in a template used by a released plan are locked.' using errcode='55000'; end if; end if;
  elsif tg_table_name='tna_template_milestones' then
    if tg_op<>'INSERT' then parent_id := (to_jsonb(old)->>'template_id')::uuid; if exists(select 1 from public.purchase_orders p where p.tna_template_id=parent_id and p.state in ('released','complete')) then raise exception 'Milestones in a template used by a released plan are locked.' using errcode='55000'; end if; end if;
    if tg_op<>'DELETE' then parent_id := (to_jsonb(new)->>'template_id')::uuid; if exists(select 1 from public.purchase_orders p where p.tna_template_id=parent_id and p.state in ('released','complete')) then raise exception 'Milestones in a template used by a released plan are locked.' using errcode='55000'; end if; end if;
  elsif tg_table_name='unit_holidays' then
    unit_key := (to_jsonb(old)->>'unit_id')::uuid;
    if exists(select 1 from public.purchase_orders p where p.unit_id=unit_key and p.state in ('released','complete')) then raise exception 'This unit calendar is locked because a production plan has been released.' using errcode='55000'; end if;
    if tg_op<>'DELETE' then unit_key := (to_jsonb(new)->>'unit_id')::uuid; if exists(select 1 from public.purchase_orders p where p.unit_id=unit_key and p.state in ('released','complete')) then raise exception 'This unit calendar is locked because a production plan has been released.' using errcode='55000'; end if; end if;
  elsif tg_table_name='risk_configuration' then
    unit_key := (to_jsonb(old)->>'unit_id')::uuid;
    if exists(select 1 from public.purchase_orders p where p.unit_id=unit_key and p.state in ('released','complete')) then raise exception 'This unit risk policy is locked because a production plan has been released.' using errcode='55000'; end if;
    if tg_op<>'DELETE' then unit_key := (to_jsonb(new)->>'unit_id')::uuid; if exists(select 1 from public.purchase_orders p where p.unit_id=unit_key and p.state in ('released','complete')) then raise exception 'This unit risk policy is locked because a production plan has been released.' using errcode='55000'; end if; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;

create trigger buyers_release_lock before insert or update or delete on public.buyers for each row execute function public.guard_released_workspace_configuration();
create trigger units_release_lock before insert or update or delete on public.production_units for each row execute function public.guard_released_workspace_configuration();
create trigger lines_release_lock before insert or update or delete on public.production_lines for each row execute function public.guard_released_workspace_configuration();
create trigger stage_templates_release_lock before insert or update or delete on public.stage_templates for each row execute function public.guard_released_workspace_configuration();
create trigger stage_steps_release_lock before insert or update or delete on public.stage_template_steps for each row execute function public.guard_released_workspace_configuration();
create trigger tna_templates_release_lock before insert or update or delete on public.tna_templates for each row execute function public.guard_released_workspace_configuration();
create trigger tna_steps_release_lock before insert or update or delete on public.tna_template_milestones for each row execute function public.guard_released_workspace_configuration();
create trigger holidays_release_lock before insert or update or delete on public.unit_holidays for each row execute function public.guard_released_workspace_configuration();
create trigger risk_policy_release_lock before insert or update or delete on public.risk_configuration for each row execute function public.guard_released_workspace_configuration();

create or replace function public.guard_released_order_plan()
returns trigger language plpgsql set search_path=public as $$
declare order_key uuid; old_order_key uuid; order_state public.order_state; old_order_state public.order_state; row_data jsonb; old_data jsonb;
begin
  if tg_table_name='purchase_orders' then
    if old.state in ('released','complete') and (
      new.buyer_id is distinct from old.buyer_id or new.unit_id is distinct from old.unit_id or
      new.po_number is distinct from old.po_number or new.style is distinct from old.style or
      new.colour is distinct from old.colour or new.ex_factory_date is distinct from old.ex_factory_date or
      new.stated_total is distinct from old.stated_total or new.total_quantity is distinct from old.total_quantity or
      new.quantity_mismatch_acknowledged is distinct from old.quantity_mismatch_acknowledged or new.released_at is distinct from old.released_at or
      new.stage_template_id is distinct from old.stage_template_id or new.stage_template_version is distinct from old.stage_template_version or
      new.tna_template_id is distinct from old.tna_template_id or new.tna_template_version is distinct from old.tna_template_version or
      new.state is distinct from old.state
    ) then raise exception 'The order plan is locked after release.' using errcode='55000'; end if;
    return new;
  end if;
  if tg_op='DELETE' then row_data:=to_jsonb(old); else row_data:=to_jsonb(new); end if;
  if tg_op='UPDATE' then
    old_data:=to_jsonb(old);
    if tg_table_name='order_sizes' or tg_table_name='order_stages' or tg_table_name='order_milestones' then old_order_key:=(old_data->>'order_id')::uuid;
    elsif tg_table_name='stage_line_assignments' or tg_table_name='stage_submitters' then select s.order_id into old_order_key from public.order_stages s where s.id=(old_data->>'stage_id')::uuid;
    end if;
    select p.state into old_order_state from public.purchase_orders p where p.id=old_order_key;
    if old_order_state in ('released','complete') then
      if tg_table_name='order_milestones' and
         (new.id is not distinct from old.id and new.order_id is not distinct from old.order_id and new.name is not distinct from old.name and
          new.target_date is not distinct from old.target_date and new.sequence_no is not distinct from old.sequence_no and
          new.owner_id is not distinct from old.owner_id and new.buyer_visible is not distinct from old.buyer_visible and
          new.notes is not distinct from old.notes and new.created_at is not distinct from old.created_at)
      then return new; end if;
      raise exception 'The production plan is locked after release. Only milestone status updates are allowed.' using errcode='55000';
    end if;
  end if;
  if tg_table_name='order_sizes' then order_key := (row_data->>'order_id')::uuid;
  elsif tg_table_name='order_stages' then order_key := (row_data->>'order_id')::uuid;
  elsif tg_table_name='stage_line_assignments' or tg_table_name='stage_submitters' then
    select s.order_id into order_key from public.order_stages s where s.id=(row_data->>'stage_id')::uuid;
  elsif tg_table_name='order_milestones' then order_key := (row_data->>'order_id')::uuid;
  end if;
  select p.state into order_state from public.purchase_orders p where p.id=order_key;
  if order_state in ('released','complete') then
    if tg_table_name='order_milestones' and tg_op='UPDATE' and
       (new.id is not distinct from old.id and new.order_id is not distinct from old.order_id and new.name is not distinct from old.name and
        new.target_date is not distinct from old.target_date and new.sequence_no is not distinct from old.sequence_no and
        new.owner_id is not distinct from old.owner_id and new.buyer_visible is not distinct from old.buyer_visible and
        new.notes is not distinct from old.notes and new.created_at is not distinct from old.created_at)
    then return new; end if;
    raise exception 'The production plan is locked after release. Only milestone status updates are allowed.' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;

create trigger released_order_freeze before update on public.purchase_orders for each row execute function public.guard_released_order_plan();
create trigger released_sizes_freeze before insert or update or delete on public.order_sizes for each row execute function public.guard_released_order_plan();
create trigger released_stages_freeze before insert or update or delete on public.order_stages for each row execute function public.guard_released_order_plan();
create trigger released_lines_freeze before insert or update or delete on public.stage_line_assignments for each row execute function public.guard_released_order_plan();
create trigger released_submitters_freeze before insert or update or delete on public.stage_submitters for each row execute function public.guard_released_order_plan();
create trigger released_milestones_freeze before insert or update or delete on public.order_milestones for each row execute function public.guard_released_order_plan();
