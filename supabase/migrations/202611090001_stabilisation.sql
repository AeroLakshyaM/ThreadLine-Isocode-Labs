-- Additive stabilization changes. Apply to a disposable test project first.

alter table public.purchase_orders
  add column if not exists released_at timestamptz;

update public.purchase_orders
set released_at = updated_at
where state in ('released','complete') and released_at is null;

create or replace function public.set_purchase_order_release_time()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.state in ('released','complete') and new.released_at is null then
    new.released_at := now();
  end if;
  return new;
end; $$;

create trigger purchase_order_release_time
before insert or update on public.purchase_orders
for each row execute function public.set_purchase_order_release_time();

alter table public.recovery_actions
  add column if not exists status text not null default 'open',
  add column if not exists updated_at timestamptz not null default now();

alter table public.recovery_actions
  drop constraint if exists recovery_actions_status_check;
alter table public.recovery_actions
  add constraint recovery_actions_status_check
  check (status in ('open','in_progress','complete','blocked'));

create or replace function public.set_recovery_action_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

create trigger recovery_action_updated_at
before update on public.recovery_actions
for each row execute function public.set_recovery_action_updated_at();

drop policy if exists "merchandiser updates recovery" on public.recovery_actions;
create policy "merchandiser updates recovery" on public.recovery_actions
for update using (public.current_role() in ('admin','merchandiser'))
with check (public.current_role() in ('admin','merchandiser'));

create trigger audit_recovery_action_updates after update on public.recovery_actions
for each row execute function public.audit_row_change();

alter table public.weekly_reports
  add column if not exists snapshot_data jsonb not null default '[]'::jsonb;
alter table public.weekly_reports
  add constraint weekly_reports_snapshot_array_check
  check (jsonb_typeof(snapshot_data) = 'array');

drop function public.get_buyer_order_progress(uuid);
create function public.get_buyer_order_progress(target_order uuid)
returns table(
  order_id uuid,po_number text,style text,colour text,total_quantity integer,
  reported_quantity integer,current_stage_name text,current_stage_target integer,
  ex_factory_date date,last_update timestamptz,milestones jsonb,buyer_remarks jsonb
)
language sql stable security definer set search_path=public as $$
  with authorized_order as (
    select po.* from public.purchase_orders po
    join public.buyer_user_access access on access.buyer_id=po.buyer_id and access.user_id=auth.uid()
    where po.id=target_order and po.state in ('released','complete')
      and po.buyer_visible and public.current_role()='buyer'
  ), stage_output as (
    select s.order_id,s.id,s.stage_name,s.sequence_no,s.target_quantity,
           coalesce(sum(u.quantity),0)::integer as output,max(u.received_at) as last_update
    from public.order_stages s
    left join public.production_updates u on u.stage_id=s.id and u.order_id=s.order_id
    where s.applicable and s.order_id=target_order
    group by s.order_id,s.id,s.stage_name,s.sequence_no,s.target_quantity
  ), latest_started_stage as (
    select so.* from stage_output so where so.output>0
    order by so.sequence_no desc limit 1
  ), first_stage as (
    select so.* from stage_output so order by so.sequence_no limit 1
  ), selected_stage as (
    select * from latest_started_stage
    union all
    select * from first_stage where not exists(select 1 from latest_started_stage)
  )
  select po.id,po.po_number,po.style,po.colour,po.total_quantity,
         coalesce(ss.output,0),ss.stage_name,ss.target_quantity,po.ex_factory_date,ss.last_update,
         coalesce((select jsonb_agg(jsonb_build_object('name',m.name,'target_date',m.target_date,'status',m.status) order by m.sequence_no)
                   from public.order_milestones m where m.order_id=po.id and m.buyer_visible),'[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('text',r.buyer_safe_text,'date',u.reporting_date) order by u.reporting_date desc)
                   from public.issue_reviews r join public.production_updates u on u.id=r.update_id
                   where u.order_id=po.id and r.buyer_safe_approved and nullif(trim(r.buyer_safe_text),'') is not null),'[]'::jsonb)
  from authorized_order po left join selected_stage ss on true
$$;

create or replace function public.buyer_can_view_approved_photo(target_order uuid,target_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.photo_approvals pa
    join public.production_updates u on u.id=pa.update_id
    join public.purchase_orders po on po.id=u.order_id
    join public.buyer_user_access a on a.buyer_id=po.buyer_id and a.user_id=auth.uid()
    where po.id=target_order and po.state in ('released','complete') and po.buyer_visible
      and pa.storage_path=target_path and pa.approved_for_buyer and public.current_role()='buyer'
  )
$$;

create or replace function public.get_buyer_approved_photo_paths(target_order uuid)
returns table(storage_path text,captured_at timestamptz)
language sql stable security definer set search_path=public as $$
  select pa.storage_path,u.captured_at
  from public.photo_approvals pa
  join public.production_updates u on u.id=pa.update_id
  join public.purchase_orders po on po.id=u.order_id
  join public.buyer_user_access a on a.buyer_id=po.buyer_id and a.user_id=auth.uid()
  where po.id=target_order and po.state in ('released','complete') and po.buyer_visible
    and pa.approved_for_buyer and public.current_role()='buyer'
  order by u.captured_at desc
$$;

grant execute on function public.get_buyer_order_progress(uuid) to authenticated;
grant execute on function public.buyer_can_view_approved_photo(uuid,text) to authenticated;
grant execute on function public.get_buyer_approved_photo_paths(uuid) to authenticated;
