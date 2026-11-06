-- Threadline initial schema. Run with Supabase CLI against a new project.
create extension if not exists pgcrypto;

create type public.app_role as enum ('merchandiser','supervisor','buyer','admin');
create type public.order_state as enum ('draft','released','complete','cancelled');
create type public.review_state as enum ('pending','approved','rejected','failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.buyer_user_access (
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (buyer_id,user_id)
);
create table public.production_units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  timezone text not null default 'Asia/Kolkata',
  working_days smallint[] not null default array[]::smallint[],
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.unit_holidays (
  unit_id uuid not null references public.production_units(id) on delete cascade,
  holiday_date date not null,
  label text not null,
  primary key(unit_id,holiday_date)
);

create table public.stage_templates (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.production_units(id) on delete cascade,
  name text not null,
  version integer not null default 1 check(version > 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(unit_id,name,version)
);
create table public.stage_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.stage_templates(id) on delete cascade,
  stage_name text not null,
  sequence_no integer not null check(sequence_no > 0),
  default_applicable boolean not null default true,
  unique(template_id,sequence_no)
);
create table public.tna_templates (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.production_units(id) on delete cascade,
  name text not null,
  version integer not null default 1 check(version > 0),
  date_basis text not null default 'ex_factory_offset' check(date_basis in ('ex_factory_offset','manual')),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(unit_id,name,version)
);
create table public.tna_template_milestones (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.tna_templates(id) on delete cascade,
  name text not null,
  offset_days integer,
  sequence_no integer not null check(sequence_no > 0),
  unique(template_id,sequence_no)
);

create table public.production_lines (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.production_units(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique(unit_id,name)
);
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  unit_id uuid not null references public.production_units(id) on delete restrict,
  po_number text not null,
  style text not null,
  colour text not null,
  ex_factory_date date not null,
  stated_total integer check(stated_total is null or stated_total >= 0),
  total_quantity integer not null default 0 check(total_quantity >= 0),
  quantity_mismatch_acknowledged boolean not null default false,
  state public.order_state not null default 'draft',
  stage_template_id uuid references public.stage_templates(id) on delete set null,
  stage_template_version integer,
  tna_template_id uuid references public.tna_templates(id) on delete set null,
  tna_template_version integer,
  buyer_visible boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(buyer_id,po_number)
);
create index purchase_orders_state_ship_idx on public.purchase_orders(state,ex_factory_date);
create index purchase_orders_buyer_idx on public.purchase_orders(buyer_id,state);
create unique index purchase_orders_buyer_po_normalized_key on public.purchase_orders(buyer_id,lower(trim(po_number)));
create table public.order_sizes (
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  size_label text not null,
  quantity integer not null check(quantity >= 0),
  primary key(order_id,size_label)
);
create function public.refresh_order_quantity() returns trigger language plpgsql security definer set search_path=public as $$
declare target_id uuid := coalesce(new.order_id,old.order_id);
begin
  update public.purchase_orders set total_quantity=coalesce((select sum(quantity) from public.order_sizes where order_id=target_id),0),updated_at=now() where id=target_id;
  return coalesce(new,old);
end; $$;
create trigger order_size_refresh after insert or update or delete on public.order_sizes for each row execute function public.refresh_order_quantity();

create table public.order_stages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  stage_name text not null,
  sequence_no integer not null check(sequence_no > 0),
  applicable boolean not null default true,
  not_applicable_reason text,
  target_quantity integer check(target_quantity is null or target_quantity >= 0),
  tna_milestone_name text,
  created_at timestamptz not null default now(),
  unique(order_id,sequence_no)
);
create table public.stage_line_assignments (
  stage_id uuid not null references public.order_stages(id) on delete cascade,
  line_id uuid not null references public.production_lines(id) on delete restrict,
  target_quantity integer check(target_quantity is null or target_quantity >= 0),
  primary key(stage_id,line_id)
);
create table public.stage_submitters (
  stage_id uuid not null references public.order_stages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key(stage_id,user_id)
);
create table public.order_milestones (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  name text not null,
  target_date date not null,
  sequence_no integer not null check(sequence_no > 0),
  status text not null default 'upcoming' check(status in ('upcoming','in_progress','complete','at_risk','overdue')),
  owner_id uuid references public.profiles(id) on delete set null,
  buyer_visible boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique(order_id,sequence_no)
);

create table public.production_updates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  order_id uuid not null references public.purchase_orders(id) on delete restrict,
  stage_id uuid not null references public.order_stages(id) on delete restrict,
  line_id uuid references public.production_lines(id) on delete restrict,
  reporting_date date not null,
  quantity integer not null check(quantity >= 0),
  zero_reason text,
  is_blocked boolean not null default false,
  issue_text text,
  photo_path text,
  audio_path text,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(quantity <> 0 or nullif(trim(zero_reason),'') is not null)
);
create index production_updates_order_date_idx on public.production_updates(order_id,reporting_date desc);
create index production_updates_stage_line_date_idx on public.production_updates(stage_id,line_id,reporting_date desc);
create unique index production_updates_one_stage_line_per_period on public.production_updates(stage_id,coalesce(line_id,'00000000-0000-0000-0000-000000000000'::uuid),reporting_date);
create table public.production_amendments (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.production_updates(id) on delete restrict,
  previous_quantity integer not null,
  corrected_quantity integer not null check(corrected_quantity >= 0),
  reason text not null,
  amended_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table public.issue_reviews (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null unique references public.production_updates(id) on delete cascade,
  original_transcription text,
  corrected_transcription text,
  translation text,
  issue_category text check(issue_category in ('material','equipment','capacity','quality','printing_finishing','other')),
  ai_provider text,
  ai_state public.review_state not null default 'pending',
  buyer_safe_text text,
  buyer_safe_approved boolean not null default false,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create function public.create_pending_issue_review() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.issue_text is not null or new.audio_path is not null then
    insert into public.issue_reviews(update_id,ai_state) values(new.id,'pending') on conflict(update_id) do nothing;
  end if;
  return new;
end; $$;
create table public.photo_approvals (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.production_updates(id) on delete cascade,
  storage_path text not null unique,
  approved_for_buyer boolean not null default false,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.recovery_actions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  stage_id uuid references public.order_stages(id) on delete set null,
  action_text text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  follow_up_date date,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table public.risk_configuration (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.production_units(id) on delete cascade,
  config_name text not null,
  recent_workdays integer not null check(recent_workdays > 0),
  amber_required_rate_ratio numeric(5,2) not null check(amber_required_rate_ratio >= 0),
  red_required_rate_ratio numeric(5,2) not null check(red_required_rate_ratio >= amber_required_rate_ratio),
  stale_after_hours integer not null check(stale_after_hours > 0),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  provisional boolean not null default true,
  created_at timestamptz not null default now(),
  unique(unit_id)
);
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  week_start date not null,
  week_end date not null check(week_end >= week_start),
  format text not null check(format in ('pdf','xlsx')),
  storage_path text,
  generated_by uuid not null references public.profiles(id) on delete restrict,
  generated_at timestamptz not null default now()
);

create function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
  select role from public.profiles where id=auth.uid() and active=true
$$;
create function public.can_access_order(target_order uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.purchase_orders po where po.id=target_order and (
    public.current_role() in ('admin','merchandiser') or
    (public.current_role()='buyer' and po.buyer_visible and exists(select 1 from public.buyer_user_access a where a.buyer_id=po.buyer_id and a.user_id=auth.uid())) or
    (public.current_role()='supervisor' and exists(select 1 from public.order_stages s join public.stage_submitters ss on ss.stage_id=s.id where s.order_id=po.id and ss.user_id=auth.uid()))
  ))
$$;

alter table public.profiles enable row level security;
alter table public.buyers enable row level security;
alter table public.buyer_user_access enable row level security;
alter table public.production_units enable row level security;
alter table public.unit_holidays enable row level security;
alter table public.stage_templates enable row level security;
alter table public.stage_template_steps enable row level security;
alter table public.tna_templates enable row level security;
alter table public.tna_template_milestones enable row level security;
alter table public.production_lines enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.order_sizes enable row level security;
alter table public.order_stages enable row level security;
alter table public.stage_line_assignments enable row level security;
alter table public.stage_submitters enable row level security;
alter table public.order_milestones enable row level security;
alter table public.production_updates enable row level security;
alter table public.production_amendments enable row level security;
alter table public.issue_reviews enable row level security;
alter table public.photo_approvals enable row level security;
alter table public.recovery_actions enable row level security;
alter table public.risk_configuration enable row level security;
alter table public.audit_log enable row level security;
alter table public.weekly_reports enable row level security;

create policy "profiles self or admin read" on public.profiles for select using (id=auth.uid() or public.current_role()='admin');
create policy "workspace leads read profiles" on public.profiles for select using (public.current_role() in ('admin','merchandiser'));
create policy "admin manages profiles" on public.profiles for all using (public.current_role()='admin') with check (public.current_role()='admin');
create policy "workspace users read buyers" on public.buyers for select using (public.current_role() in ('admin','merchandiser','supervisor') or exists(select 1 from public.buyer_user_access a where a.buyer_id=id and a.user_id=auth.uid()));
create policy "admin manages buyers" on public.buyers for all using(public.current_role()='admin') with check(public.current_role()='admin');
create policy "buyer reads own mapping" on public.buyer_user_access for select using(user_id=auth.uid() or public.current_role()='admin');
create policy "admin manages buyer mapping" on public.buyer_user_access for all using(public.current_role()='admin') with check(public.current_role()='admin');
create policy "workspace reads units" on public.production_units for select using(public.current_role() in ('admin','merchandiser','supervisor'));
create policy "admin manages units" on public.production_units for all using(public.current_role()='admin') with check(public.current_role()='admin');
create policy "workspace reads holidays" on public.unit_holidays for select using(public.current_role() is not null);
create policy "admin manages holidays" on public.unit_holidays for all using(public.current_role()='admin') with check(public.current_role()='admin');

create policy "workspace reads stage templates" on public.stage_templates for select using(public.current_role() in ('admin','merchandiser','supervisor'));
create policy "admin manages stage templates" on public.stage_templates for all using(public.current_role()='admin') with check(public.current_role()='admin');
create policy "workspace reads stage template steps" on public.stage_template_steps for select using(exists(select 1 from public.stage_templates t where t.id=template_id));
create policy "admin manages stage template steps" on public.stage_template_steps for all using(public.current_role()='admin') with check(public.current_role()='admin');
create policy "workspace reads TNA templates" on public.tna_templates for select using(public.current_role() in ('admin','merchandiser'));
create policy "admin manages TNA templates" on public.tna_templates for all using(public.current_role()='admin') with check(public.current_role()='admin');
create policy "workspace reads TNA template milestones" on public.tna_template_milestones for select using(exists(select 1 from public.tna_templates t where t.id=template_id));
create policy "admin manages TNA template milestones" on public.tna_template_milestones for all using(public.current_role()='admin') with check(public.current_role()='admin');
create policy "workspace reads lines" on public.production_lines for select using(public.current_role() in ('admin','merchandiser','supervisor'));
create policy "admin manages lines" on public.production_lines for all using(public.current_role()='admin') with check(public.current_role()='admin');

create policy "orders scoped read" on public.purchase_orders for select using(public.can_access_order(id));
create policy "merchandiser creates orders" on public.purchase_orders for insert with check(public.current_role() in ('merchandiser','admin') and created_by=auth.uid());
create policy "merchandiser updates orders" on public.purchase_orders for update using(public.current_role() in ('merchandiser','admin')) with check(public.current_role() in ('merchandiser','admin'));
create policy "merchandiser deletes drafts" on public.purchase_orders for delete using(public.current_role() in ('merchandiser','admin') and state='draft');
create policy "order sizes scoped" on public.order_sizes for select using(public.current_role() in ('admin','merchandiser','supervisor') and public.can_access_order(order_id));
create policy "order sizes draft edit" on public.order_sizes for all using(public.current_role() in ('merchandiser','admin') and exists(select 1 from public.purchase_orders p where p.id=order_id and p.state='draft')) with check(public.current_role() in ('merchandiser','admin') and exists(select 1 from public.purchase_orders p where p.id=order_id and p.state='draft'));
create policy "stages scoped read" on public.order_stages for select using(public.current_role() in ('admin','merchandiser','supervisor') and public.can_access_order(order_id));
create policy "merchandiser manages stages" on public.order_stages for all using(public.current_role() in ('merchandiser','admin')) with check(public.current_role() in ('merchandiser','admin'));
create policy "stage lines scoped" on public.stage_line_assignments for select using(public.current_role() in ('admin','merchandiser','supervisor') and exists(select 1 from public.order_stages s where s.id=stage_id and public.can_access_order(s.order_id)));
create policy "merchandiser manages stage lines" on public.stage_line_assignments for all using(public.current_role() in ('merchandiser','admin')) with check(public.current_role() in ('merchandiser','admin'));
create policy "submitters scoped" on public.stage_submitters for select using(user_id=auth.uid() or public.current_role() in ('admin','merchandiser'));
create policy "merchandiser manages submitters" on public.stage_submitters for all using(public.current_role() in ('admin','merchandiser')) with check(public.current_role() in ('admin','merchandiser'));
create policy "milestones scoped read" on public.order_milestones for select using(public.can_access_order(order_id) and (public.current_role()<>'buyer' or buyer_visible));
create policy "merchandiser manages milestones" on public.order_milestones for all using(public.current_role() in ('merchandiser','admin')) with check(public.current_role() in ('merchandiser','admin'));

create policy "updates scoped read" on public.production_updates for select using(public.current_role() in ('admin','merchandiser') or (public.current_role()='supervisor' and submitted_by=auth.uid()));
create policy "assigned supervisor inserts updates" on public.production_updates for insert with check(public.current_role()='supervisor' and submitted_by=auth.uid() and exists(select 1 from public.order_stages s join public.stage_submitters ss on ss.stage_id=s.id where s.id=production_updates.stage_id and s.order_id=production_updates.order_id and ss.user_id=auth.uid()) and ((production_updates.line_id is not null and exists(select 1 from public.stage_line_assignments sla where sla.stage_id=production_updates.stage_id and sla.line_id=production_updates.line_id)) or (production_updates.line_id is null and not exists(select 1 from public.stage_line_assignments sla where sla.stage_id=production_updates.stage_id))));
create policy "updates cannot be edited or deleted" on public.production_updates for update using(false);
create policy "updates cannot be deleted" on public.production_updates for delete using(false);
create policy "amendments scoped read" on public.production_amendments for select using(public.current_role() in ('admin','merchandiser'));
create policy "merchandiser creates amendments" on public.production_amendments for insert with check(public.current_role() in ('admin','merchandiser') and amended_by=auth.uid());
create policy "issue review internal read" on public.issue_reviews for select using(public.current_role() in ('admin','merchandiser','supervisor'));
create policy "merchandiser reviews issues" on public.issue_reviews for all using(public.current_role() in ('admin','merchandiser')) with check(public.current_role() in ('admin','merchandiser'));
create policy "photo approvals internal read" on public.photo_approvals for select using(public.current_role() in ('admin','merchandiser','supervisor'));
create policy "merchandiser approves photos" on public.photo_approvals for all using(public.current_role() in ('admin','merchandiser')) with check(public.current_role() in ('admin','merchandiser'));
create policy "recovery actions scoped" on public.recovery_actions for select using(public.current_role() in ('admin','merchandiser'));
create policy "merchandiser records recovery" on public.recovery_actions for insert with check(public.current_role() in ('admin','merchandiser') and created_by=auth.uid());
create policy "risk config read" on public.risk_configuration for select using(public.current_role() in ('admin','merchandiser','supervisor'));
create policy "admin manages risk config" on public.risk_configuration for all using(public.current_role()='admin') with check(public.current_role()='admin');
create policy "audit read admin merch" on public.audit_log for select using(public.current_role() in ('admin','merchandiser'));
create policy "audit insert authenticated" on public.audit_log for insert with check(actor_id=auth.uid());
create policy "reports scoped read" on public.weekly_reports for select using(public.current_role() in ('admin','merchandiser') or exists(select 1 from public.buyer_user_access a where a.buyer_id=weekly_reports.buyer_id and a.user_id=auth.uid()));
create policy "merchandiser creates reports" on public.weekly_reports for insert with check(public.current_role() in ('admin','merchandiser') and generated_by=auth.uid());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('production-evidence','production-evidence',false,5242880,array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4','audio/mpeg'])
on conflict(id) do nothing;
create policy "authorized users read production evidence" on storage.objects for select to authenticated using(bucket_id='production-evidence' and public.current_role() in ('admin','merchandiser','supervisor') and exists(select 1 from public.production_updates u where (u.photo_path=name or u.audio_path=name) and public.can_access_order(u.order_id)));
create policy "assigned supervisors upload evidence" on storage.objects for insert to authenticated with check(bucket_id='production-evidence' and public.current_role()='supervisor' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and public.can_access_order(((storage.foldername(name))[1])::uuid));
create policy "supervisors replace own evidence" on storage.objects for update to authenticated using(bucket_id='production-evidence' and public.current_role()='supervisor' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and public.can_access_order(((storage.foldername(name))[1])::uuid)) with check(bucket_id='production-evidence' and public.current_role()='supervisor' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and public.can_access_order(((storage.foldername(name))[1])::uuid));

create trigger production_update_issue_review after insert on public.production_updates for each row execute function public.create_pending_issue_review();
create function public.create_pending_photo_approval() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.photo_path is not null then
    insert into public.photo_approvals(update_id,storage_path,approved_for_buyer) values(new.id,new.photo_path,false) on conflict(storage_path) do nothing;
  end if;
  return new;
end; $$;
create trigger production_update_photo_approval after insert on public.production_updates for each row execute function public.create_pending_photo_approval();

-- Buyer-facing data is exposed only through approved fields. Keep this view invoker-scoped.
create function public.get_buyer_order_progress(target_order uuid)
returns table(order_id uuid,po_number text,style text,colour text,total_quantity integer,reported_quantity integer,ex_factory_date date,last_update timestamptz,milestones jsonb,buyer_remarks jsonb)
language sql stable security definer set search_path=public as $$
  with authorized_order as (
    select po.* from public.purchase_orders po
    join public.buyer_user_access access on access.buyer_id=po.buyer_id and access.user_id=auth.uid()
    where po.id=target_order and po.state='released' and po.buyer_visible and public.current_role()='buyer'
  ), stage_output as (
    select s.order_id,s.id,s.sequence_no,coalesce(sum(u.quantity),0)::integer as output,max(u.received_at) as last_update
    from public.order_stages s left join public.production_updates u on u.stage_id=s.id
    where s.applicable and s.order_id=target_order group by s.order_id,s.id,s.sequence_no
  ), current_stage as (
    select so.* from stage_output so where so.output>0
    order by so.sequence_no desc limit 1
  )
  select po.id,po.po_number,po.style,po.colour,po.total_quantity,
         coalesce(cs.output,0),po.ex_factory_date,cs.last_update,
         coalesce((select jsonb_agg(jsonb_build_object('name',m.name,'target_date',m.target_date,'status',m.status) order by m.sequence_no)
                   from public.order_milestones m where m.order_id=po.id and m.buyer_visible),'[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('text',r.buyer_safe_text,'date',u.reporting_date) order by u.reporting_date desc)
                   from public.issue_reviews r join public.production_updates u on u.id=r.update_id
                   where u.order_id=po.id and r.buyer_safe_approved and nullif(trim(r.buyer_safe_text),'') is not null),'[]'::jsonb)
  from authorized_order po left join current_stage cs on cs.order_id=po.id
$$;

create function public.buyer_can_view_approved_photo(target_order uuid,target_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.photo_approvals pa
    join public.production_updates u on u.id=pa.update_id
    join public.purchase_orders po on po.id=u.order_id
    join public.buyer_user_access a on a.buyer_id=po.buyer_id and a.user_id=auth.uid()
    where po.id=target_order and po.state='released' and po.buyer_visible
      and pa.storage_path=target_path and pa.approved_for_buyer and public.current_role()='buyer'
  )
$$;

create function public.get_buyer_approved_photo_paths(target_order uuid)
returns table(storage_path text,captured_at timestamptz)
language sql stable security definer set search_path=public as $$
  select pa.storage_path,u.captured_at
  from public.photo_approvals pa join public.production_updates u on u.id=pa.update_id
  join public.purchase_orders po on po.id=u.order_id
  join public.buyer_user_access a on a.buyer_id=po.buyer_id and a.user_id=auth.uid()
  where po.id=target_order and po.state='released' and po.buyer_visible and pa.approved_for_buyer and public.current_role()='buyer'
  order by u.captured_at desc
$$;

create function public.create_order_draft(
  buyer_id_input uuid,unit_id_input uuid,po_number_input text,style_input text,colour_input text,
  ex_factory_date_input date,stated_total_input integer,sizes_input jsonb,mismatch_acknowledged_input boolean default false
) returns uuid language plpgsql security definer set search_path=public as $$
declare new_order_id uuid; calculated_total integer; item jsonb;
begin
  if public.current_role() not in ('admin','merchandiser') then raise exception 'Only a merchandiser can create an order.' using errcode='42501'; end if;
  if nullif(trim(po_number_input),'') is null or nullif(trim(style_input),'') is null or nullif(trim(colour_input),'') is null then raise exception 'PO, style and colour are required.'; end if;
  if not exists(select 1 from public.buyers where id=buyer_id_input and active) then raise exception 'Select an active buyer.'; end if;
  if not exists(select 1 from public.production_units where id=unit_id_input and active) then raise exception 'Select an active production unit.'; end if;
  if jsonb_typeof(sizes_input)<>'array' or jsonb_array_length(sizes_input)=0 then raise exception 'Add at least one size quantity.'; end if;
  select coalesce(sum((value->>'quantity')::integer),0) into calculated_total from jsonb_array_elements(sizes_input);
  if exists(select 1 from jsonb_array_elements(sizes_input) as items(value) where nullif(trim(value->>'size_label'),'') is null or coalesce(value->>'quantity','') !~ '^[0-9]+$') then raise exception 'Size names and non-negative whole quantities are required.'; end if;
  if stated_total_input is not null and stated_total_input<>calculated_total and not mismatch_acknowledged_input then raise exception 'The size total differs from the PO total. Acknowledge the mismatch to save the draft.'; end if;
  insert into public.purchase_orders(buyer_id,unit_id,po_number,style,colour,ex_factory_date,stated_total,total_quantity,quantity_mismatch_acknowledged,state,created_by)
  values(buyer_id_input,unit_id_input,trim(po_number_input),trim(style_input),trim(colour_input),ex_factory_date_input,stated_total_input,calculated_total,mismatch_acknowledged_input,'draft',auth.uid()) returning id into new_order_id;
  for item in select value from jsonb_array_elements(sizes_input) loop
    insert into public.order_sizes(order_id,size_label,quantity) values(new_order_id,trim(item->>'size_label'),(item->>'quantity')::integer);
  end loop;
  return new_order_id;
end; $$;

create function public.save_order_plan(
  order_id_input uuid,stage_template_id_input uuid,tna_template_id_input uuid,
  stages_input jsonb,milestones_input jsonb,release_input boolean default false,buyer_visible_input boolean default false
) returns void language plpgsql security definer set search_path=public as $$
declare po public.purchase_orders%rowtype; stage_item jsonb; line_item jsonb; milestone_item jsonb; new_stage_id uuid; submitter_id uuid;
begin
  if public.current_role() not in ('admin','merchandiser') then raise exception 'Only an authorised merchandiser can update the production plan.' using errcode='42501'; end if;
  if buyer_visible_input and not release_input then raise exception 'Only released orders can be shared with a buyer.'; end if;
  select * into po from public.purchase_orders where id=order_id_input for update;
  if not found or po.state<>'draft' then raise exception 'Only draft orders can be planned or released.'; end if;
  if not exists(select 1 from public.stage_templates t where t.id=stage_template_id_input and t.active and (t.unit_id is null or t.unit_id=po.unit_id)) then raise exception 'Select an active stage template for this production unit.'; end if;
  if not exists(select 1 from public.tna_templates t where t.id=tna_template_id_input and t.active and (t.unit_id is null or t.unit_id=po.unit_id)) then raise exception 'Select an active TNA template for this production unit.'; end if;
  if jsonb_typeof(stages_input)<>'array' or jsonb_array_length(stages_input)=0 then raise exception 'Add at least one production stage.'; end if;
  if jsonb_typeof(milestones_input)<>'array' or jsonb_array_length(milestones_input)=0 then raise exception 'Add at least one TNA milestone.'; end if;
  if jsonb_array_length(stages_input)<>(select count(*) from public.stage_template_steps where template_id=stage_template_id_input) then raise exception 'The selected route has changed. Reload and review it again.'; end if;
  if exists(select 1 from jsonb_array_elements(stages_input) as items(value) where not exists(select 1 from public.stage_template_steps step where step.template_id=stage_template_id_input and step.sequence_no=(value->>'sequence_no')::integer and lower(trim(step.stage_name))=lower(trim(value->>'stage_name')))) then raise exception 'Stage names and sequence must match the selected route template.'; end if;
  if jsonb_array_length(milestones_input)<>(select count(*) from public.tna_template_milestones where template_id=tna_template_id_input) then raise exception 'The selected TNA template has changed. Reload and review it again.'; end if;
  if exists(select 1 from jsonb_array_elements(milestones_input) as items(value) where not exists(select 1 from public.tna_template_milestones milestone where milestone.template_id=tna_template_id_input and milestone.sequence_no=(value->>'sequence_no')::integer and lower(trim(milestone.name))=lower(trim(value->>'name')))) then raise exception 'Milestone names and sequence must match the selected TNA template.'; end if;
  if exists(select 1 from jsonb_array_elements(stages_input) as items(value) where nullif(trim(value->>'tna_milestone_name'),'') is not null and not exists(select 1 from jsonb_array_elements(milestones_input) m where lower(trim(m.value->>'name'))=lower(trim(value->>'tna_milestone_name')))) then raise exception 'A stage is linked to a milestone outside the selected TNA plan.'; end if;
  if release_input and exists(select 1 from jsonb_array_elements(stages_input) as items(value) where coalesce((value->>'applicable')::boolean,false) and jsonb_array_length(coalesce(value->'submitter_ids','[]'::jsonb))=0) then raise exception 'Assign at least one supervisor to each applicable production stage.'; end if;
  delete from public.order_stages where order_id=order_id_input;
  delete from public.order_milestones where order_id=order_id_input;
  for stage_item in select value from jsonb_array_elements(stages_input) loop
    insert into public.order_stages(order_id,stage_name,sequence_no,applicable,not_applicable_reason,target_quantity,tna_milestone_name)
    values(order_id_input,trim(stage_item->>'stage_name'),(stage_item->>'sequence_no')::integer,coalesce((stage_item->>'applicable')::boolean,true),nullif(trim(stage_item->>'not_applicable_reason'),''),nullif(stage_item->>'target_quantity','')::integer,nullif(trim(stage_item->>'tna_milestone_name'),'')) returning id into new_stage_id;
    if coalesce((stage_item->>'applicable')::boolean,true) then
      for submitter_id in select jsonb_array_elements_text(coalesce(stage_item->'submitter_ids','[]'::jsonb))::uuid loop
        if not exists(select 1 from public.profiles p where p.id=submitter_id and p.role='supervisor' and p.active) then raise exception 'Select an active authorised supervisor.'; end if;
        insert into public.stage_submitters(stage_id,user_id) values(new_stage_id,submitter_id) on conflict do nothing;
      end loop;
      for line_item in select value from jsonb_array_elements(coalesce(stage_item->'lines','[]'::jsonb)) loop
        if not exists(select 1 from public.production_lines l where l.id=(line_item->>'line_id')::uuid and l.unit_id=po.unit_id and l.active) then raise exception 'A selected line does not belong to this production unit.'; end if;
        insert into public.stage_line_assignments(stage_id,line_id,target_quantity) values(new_stage_id,(line_item->>'line_id')::uuid,nullif(line_item->>'target_quantity','')::integer);
        for submitter_id in select jsonb_array_elements_text(coalesce(line_item->'submitter_ids','[]'::jsonb))::uuid loop
          if not exists(select 1 from public.profiles p where p.id=submitter_id and p.role='supervisor' and p.active) then raise exception 'Select an active authorised supervisor.'; end if;
          insert into public.stage_submitters(stage_id,user_id) values(new_stage_id,submitter_id) on conflict do nothing;
        end loop;
      end loop;
    end if;
  end loop;
  for milestone_item in select value from jsonb_array_elements(milestones_input) loop
    insert into public.order_milestones(order_id,name,target_date,sequence_no,status,owner_id,buyer_visible,notes)
    values(order_id_input,trim(milestone_item->>'name'),(milestone_item->>'target_date')::date,(milestone_item->>'sequence_no')::integer,'upcoming',nullif(milestone_item->>'owner_id','')::uuid,coalesce((milestone_item->>'buyer_visible')::boolean,false),nullif(trim(milestone_item->>'notes'),''));
  end loop;
  update public.purchase_orders set stage_template_id=stage_template_id_input,
    stage_template_version=(select version from public.stage_templates where id=stage_template_id_input),
    tna_template_id=tna_template_id_input,tna_template_version=(select version from public.tna_templates where id=tna_template_id_input),
    state=case when release_input then 'released'::public.order_state else 'draft'::public.order_state end,
    buyer_visible=(release_input and buyer_visible_input),updated_at=now()
  where id=order_id_input;
end; $$;

create function public.audit_row_change() returns trigger language plpgsql security definer set search_path=public as $$
declare row_id text;
begin
  row_id := coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id',to_jsonb(new)->>'client_id',to_jsonb(old)->>'client_id','unknown');
  insert into public.audit_log(actor_id,action,entity_type,entity_id)
  values(auth.uid(),lower(tg_op),tg_table_name,row_id);
  return coalesce(new,old);
end; $$;
create trigger audit_purchase_orders after insert or update or delete on public.purchase_orders for each row execute function public.audit_row_change();
create trigger audit_order_milestones after insert or update or delete on public.order_milestones for each row execute function public.audit_row_change();
create trigger audit_production_updates after insert on public.production_updates for each row execute function public.audit_row_change();
create trigger audit_production_amendments after insert on public.production_amendments for each row execute function public.audit_row_change();
create trigger audit_issue_reviews after insert or update on public.issue_reviews for each row execute function public.audit_row_change();
create trigger audit_photo_approvals after insert or update on public.photo_approvals for each row execute function public.audit_row_change();
create trigger audit_recovery_actions after insert on public.recovery_actions for each row execute function public.audit_row_change();
create trigger audit_risk_configuration after insert or update on public.risk_configuration for each row execute function public.audit_row_change();

grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.can_access_order(uuid) to authenticated;
grant execute on function public.get_buyer_order_progress(uuid) to authenticated;
grant execute on function public.buyer_can_view_approved_photo(uuid,text) to authenticated;
grant execute on function public.get_buyer_approved_photo_paths(uuid) to authenticated;
grant execute on function public.create_order_draft(uuid,uuid,text,text,text,date,integer,jsonb,boolean) to authenticated;
grant execute on function public.save_order_plan(uuid,uuid,uuid,jsonb,jsonb,boolean,boolean) to authenticated;
