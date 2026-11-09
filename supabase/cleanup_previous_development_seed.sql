-- Removes only the exact synthetic workspace rows from the old development seed.
-- Run this only in the Supabase project where that seed was previously applied.
-- It never deletes purchase orders, users, or updates. It aborts if the seeded
-- buyers, units, lines, calendars, policies, or templates have been put into use.
begin;

do $$
declare
  demo_unit_ids uuid[];
  demo_buyer_ids uuid[];
  demo_line_ids uuid[];
begin
  select coalesce(array_agg(id), '{}'::uuid[]) into demo_unit_ids
  from public.production_units
  where name in (
    'Demo Unit 01 · Avinashi',
    'Demo Unit 02 · Tiruppur',
    'Demo Unit 03 · Palladam'
  );

  select coalesce(array_agg(id), '{}'::uuid[]) into demo_buyer_ids
  from public.buyers
  where name in ('Northstar Kids', 'Harbor & Pine', 'Westwind Studio');

  select coalesce(array_agg(id), '{}'::uuid[]) into demo_line_ids
  from public.production_lines
  where unit_id = any(demo_unit_ids)
    and name in ('Line A', 'Line B', 'Line C');

  if exists (
    select 1 from public.purchase_orders
    where buyer_id = any(demo_buyer_ids) or unit_id = any(demo_unit_ids)
  ) then
    raise exception 'Cleanup stopped: a seeded buyer or unit is linked to an order.';
  end if;

  if exists (select 1 from public.buyer_user_access where buyer_id = any(demo_buyer_ids))
     or exists (select 1 from public.weekly_reports where buyer_id = any(demo_buyer_ids)) then
    raise exception 'Cleanup stopped: a seeded buyer is linked to user access or a report.';
  end if;

  if exists (select 1 from public.stage_line_assignments where line_id = any(demo_line_ids))
     or exists (select 1 from public.production_updates where line_id = any(demo_line_ids)) then
    raise exception 'Cleanup stopped: a seeded production line has been used.';
  end if;

  if exists (select 1 from public.unit_holidays where unit_id = any(demo_unit_ids))
     or exists (select 1 from public.risk_configuration where unit_id = any(demo_unit_ids)) then
    raise exception 'Cleanup stopped: a seeded unit has calendar or risk-policy data.';
  end if;

  if exists (
    select 1 from public.stage_templates
    where unit_id = any(demo_unit_ids)
      and not (name = 'Illustrative knitwear route · review before use' and version = 1)
  ) or exists (
    select 1 from public.tna_templates
    where unit_id = any(demo_unit_ids)
      and not (name = 'Illustrative export schedule · review before use' and version = 1)
  ) then
    raise exception 'Cleanup stopped: a seeded unit has templates beyond the old development seed.';
  end if;

  if exists (
    select 1 from public.production_lines
    where unit_id = any(demo_unit_ids)
      and name not in ('Line A', 'Line B', 'Line C')
  ) then
    raise exception 'Cleanup stopped: a seeded unit has production lines beyond the old development seed.';
  end if;

  delete from public.stage_templates
  where unit_id = any(demo_unit_ids)
    and name = 'Illustrative knitwear route · review before use'
    and version = 1;

  delete from public.tna_templates
  where unit_id = any(demo_unit_ids)
    and name = 'Illustrative export schedule · review before use'
    and version = 1;

  delete from public.production_lines
  where unit_id = any(demo_unit_ids)
    and name in ('Line A', 'Line B', 'Line C');

  delete from public.production_units
  where id = any(demo_unit_ids);

  delete from public.buyers
  where id = any(demo_buyer_ids);
end;
$$;

commit;
