-- Move factory, buyer, template, and order operations to the merchandiser role.
-- Administrators retain user provisioning/password request management only.
-- Apply after the initial schema and migrations 202611090001-003.

-- Workspace configuration is maintained by merchandisers.
-- User and buyer-user mapping mutations remain behind the authenticated
-- manage-users Edge Function; its service-role client bypasses these policies.
drop policy if exists "admin manages profiles" on public.profiles;
drop policy if exists "admin manages buyer mapping" on public.buyer_user_access;
drop policy if exists "audit insert authenticated" on public.audit_log;

drop policy if exists "admin manages buyers" on public.buyers;
create policy "merchandisers manage buyers" on public.buyers for all
  using (public.current_role()='merchandiser') with check (public.current_role()='merchandiser');

drop policy if exists "admin manages units" on public.production_units;
create policy "merchandisers manage units" on public.production_units for all
  using (public.current_role()='merchandiser') with check (public.current_role()='merchandiser');

drop policy if exists "admin manages holidays" on public.unit_holidays;
create policy "merchandisers manage holidays" on public.unit_holidays for all
  using (public.current_role()='merchandiser') with check (public.current_role()='merchandiser');

drop policy if exists "admin manages stage templates" on public.stage_templates;
create policy "merchandisers manage stage templates" on public.stage_templates for all
  using (public.current_role()='merchandiser') with check (public.current_role()='merchandiser');

drop policy if exists "admin manages stage template steps" on public.stage_template_steps;
create policy "merchandisers manage stage template steps" on public.stage_template_steps for all
  using (public.current_role()='merchandiser') with check (public.current_role()='merchandiser');

drop policy if exists "admin manages TNA templates" on public.tna_templates;
create policy "merchandisers manage TNA templates" on public.tna_templates for all
  using (public.current_role()='merchandiser') with check (public.current_role()='merchandiser');

drop policy if exists "admin manages TNA template milestones" on public.tna_template_milestones;
create policy "merchandisers manage TNA template milestones" on public.tna_template_milestones for all
  using (public.current_role()='merchandiser') with check (public.current_role()='merchandiser');

drop policy if exists "admin manages lines" on public.production_lines;
create policy "merchandisers manage lines" on public.production_lines for all
  using (public.current_role()='merchandiser') with check (public.current_role()='merchandiser');

drop policy if exists "admin manages risk config" on public.risk_configuration;
create policy "merchandisers manage risk config" on public.risk_configuration for all
  using (public.current_role()='merchandiser') with check (public.current_role()='merchandiser');

drop policy if exists "workspace users read buyers" on public.buyers;
create policy "workspace users read buyers" on public.buyers for select
  using (public.current_role() in ('merchandiser','supervisor') or exists(select 1 from public.buyer_user_access a where a.buyer_id=id and a.user_id=auth.uid()));
drop policy if exists "workspace reads units" on public.production_units;
create policy "workspace reads units" on public.production_units for select
  using(public.current_role() in ('merchandiser','supervisor'));
drop policy if exists "workspace reads holidays" on public.unit_holidays;
create policy "workspace reads holidays" on public.unit_holidays for select
  using(public.current_role() in ('merchandiser','supervisor'));
drop policy if exists "workspace reads stage templates" on public.stage_templates;
create policy "workspace reads stage templates" on public.stage_templates for select
  using(public.current_role() in ('merchandiser','supervisor'));
drop policy if exists "workspace reads TNA templates" on public.tna_templates;
create policy "workspace reads TNA templates" on public.tna_templates for select
  using(public.current_role()='merchandiser');
drop policy if exists "workspace reads lines" on public.production_lines;
create policy "workspace reads lines" on public.production_lines for select
  using(public.current_role() in ('merchandiser','supervisor'));
drop policy if exists "risk config read" on public.risk_configuration;
create policy "risk config read" on public.risk_configuration for select
  using(public.current_role() in ('merchandiser','supervisor'));

-- Keep administrator access to user records/mappings, but remove access to
-- production orders and evidence through the operational data policies.
create or replace function public.can_access_order(target_order uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.purchase_orders po where po.id=target_order and (
    public.current_role()='merchandiser' or
    (public.current_role()='buyer' and po.buyer_visible and exists(select 1 from public.buyer_user_access a where a.buyer_id=po.buyer_id and a.user_id=auth.uid())) or
    (public.current_role()='supervisor' and exists(select 1 from public.order_stages s join public.stage_submitters ss on ss.stage_id=s.id where s.order_id=po.id and ss.user_id=auth.uid()))
  ))
$$;

drop policy if exists "merchandiser creates orders" on public.purchase_orders;
create policy "merchandiser creates orders" on public.purchase_orders for insert
  with check(public.current_role()='merchandiser' and created_by=auth.uid());
drop policy if exists "merchandiser updates orders" on public.purchase_orders;
create policy "merchandiser updates orders" on public.purchase_orders for update
  using(public.current_role()='merchandiser') with check(public.current_role()='merchandiser');
drop policy if exists "merchandiser deletes drafts" on public.purchase_orders;
create policy "merchandiser deletes drafts" on public.purchase_orders for delete
  using(public.current_role()='merchandiser' and state='draft');

drop policy if exists "order sizes scoped" on public.order_sizes;
create policy "order sizes scoped" on public.order_sizes for select
  using(public.current_role() in ('merchandiser','supervisor') and public.can_access_order(order_id));
drop policy if exists "order sizes draft edit" on public.order_sizes;
create policy "order sizes draft edit" on public.order_sizes for all
  using(public.current_role()='merchandiser' and exists(select 1 from public.purchase_orders p where p.id=order_id and p.state='draft'))
  with check(public.current_role()='merchandiser' and exists(select 1 from public.purchase_orders p where p.id=order_id and p.state='draft'));

drop policy if exists "stages scoped read" on public.order_stages;
create policy "stages scoped read" on public.order_stages for select
  using(public.current_role() in ('merchandiser','supervisor') and public.can_access_order(order_id));
drop policy if exists "merchandiser manages stages" on public.order_stages;
create policy "merchandiser manages stages" on public.order_stages for all
  using(public.current_role()='merchandiser') with check(public.current_role()='merchandiser');

drop policy if exists "stage lines scoped" on public.stage_line_assignments;
create policy "stage lines scoped" on public.stage_line_assignments for select
  using(public.current_role() in ('merchandiser','supervisor') and exists(select 1 from public.order_stages s where s.id=stage_id and public.can_access_order(s.order_id)));
drop policy if exists "merchandiser manages stage lines" on public.stage_line_assignments;
create policy "merchandiser manages stage lines" on public.stage_line_assignments for all
  using(public.current_role()='merchandiser') with check(public.current_role()='merchandiser');

drop policy if exists "submitters scoped" on public.stage_submitters;
create policy "submitters scoped" on public.stage_submitters for select
  using(user_id=auth.uid() or public.current_role()='merchandiser');
drop policy if exists "merchandiser manages submitters" on public.stage_submitters;
create policy "merchandiser manages submitters" on public.stage_submitters for all
  using(public.current_role()='merchandiser') with check(public.current_role()='merchandiser');

drop policy if exists "merchandiser manages milestones" on public.order_milestones;
create policy "merchandiser manages milestones" on public.order_milestones for all
  using(public.current_role()='merchandiser') with check(public.current_role()='merchandiser');
drop policy if exists "updates scoped read" on public.production_updates;
create policy "updates scoped read" on public.production_updates for select
  using(public.current_role()='merchandiser' or (public.current_role()='supervisor' and submitted_by=auth.uid()));
drop policy if exists "amendments scoped read" on public.production_amendments;
create policy "amendments scoped read" on public.production_amendments for select
  using(public.current_role()='merchandiser');
drop policy if exists "merchandiser creates amendments" on public.production_amendments;
create policy "merchandiser creates amendments" on public.production_amendments for insert
  with check(public.current_role()='merchandiser' and amended_by=auth.uid());
drop policy if exists "issue review internal read" on public.issue_reviews;
create policy "issue review internal read" on public.issue_reviews for select
  using(public.current_role() in ('merchandiser','supervisor'));
drop policy if exists "merchandiser reviews issues" on public.issue_reviews;
create policy "merchandiser reviews issues" on public.issue_reviews for all
  using(public.current_role()='merchandiser') with check(public.current_role()='merchandiser');
drop policy if exists "photo approvals internal read" on public.photo_approvals;
create policy "photo approvals internal read" on public.photo_approvals for select
  using(public.current_role() in ('merchandiser','supervisor'));
drop policy if exists "merchandiser approves photos" on public.photo_approvals;
create policy "merchandiser approves photos" on public.photo_approvals for all
  using(public.current_role()='merchandiser') with check(public.current_role()='merchandiser');
drop policy if exists "recovery actions scoped" on public.recovery_actions;
create policy "recovery actions scoped" on public.recovery_actions for select
  using(public.current_role()='merchandiser');
drop policy if exists "merchandiser records recovery" on public.recovery_actions;
create policy "merchandiser records recovery" on public.recovery_actions for insert
  with check(public.current_role()='merchandiser' and created_by=auth.uid());
drop policy if exists "merchandiser updates recovery" on public.recovery_actions;
create policy "merchandiser updates recovery" on public.recovery_actions for update
  using(public.current_role()='merchandiser') with check(public.current_role()='merchandiser');
drop policy if exists "audit read admin merch" on public.audit_log;
create policy "audit read admin merch" on public.audit_log for select
  using(public.current_role()='merchandiser');
drop policy if exists "reports scoped read" on public.weekly_reports;
create policy "reports scoped read" on public.weekly_reports for select
  using(public.current_role()='merchandiser' or exists(select 1 from public.buyer_user_access a where a.buyer_id=weekly_reports.buyer_id and a.user_id=auth.uid()));
drop policy if exists "merchandiser creates reports" on public.weekly_reports;
create policy "merchandiser creates reports" on public.weekly_reports for insert
  with check(public.current_role()='merchandiser' and generated_by=auth.uid());
drop policy if exists "authorized users read production evidence" on storage.objects;
create policy "authorized users read production evidence" on storage.objects for select to authenticated
  using(bucket_id='production-evidence' and public.current_role() in ('merchandiser','supervisor') and exists(select 1 from public.production_updates u where (u.photo_path=name or u.audio_path=name) and public.can_access_order(u.order_id)));

-- Account management stays with admins. Order creation and planning belong to
-- merchandisers, including when the functions run with SECURITY DEFINER.
create or replace function public.create_order_draft(
  buyer_id_input uuid,unit_id_input uuid,po_number_input text,style_input text,colour_input text,
  ex_factory_date_input date,stated_total_input integer,sizes_input jsonb,mismatch_acknowledged_input boolean default false
) returns uuid language plpgsql security definer set search_path=public as $$
declare new_order_id uuid; calculated_total integer; item jsonb;
begin
  if public.current_role()<>'merchandiser' then raise exception 'Only a merchandiser can create an order.' using errcode='42501'; end if;
  if nullif(trim(po_number_input),'') is null or nullif(trim(style_input),'') is null or nullif(trim(colour_input),'') is null then raise exception 'PO, style and colour are required.'; end if;
  if not exists(select 1 from public.buyers where id=buyer_id_input and active) then raise exception 'Select an active buyer.'; end if;
  if not exists(select 1 from public.production_units where id=unit_id_input and active) then raise exception 'Select an active production unit.'; end if;
  if jsonb_typeof(sizes_input)<>'array' or jsonb_array_length(sizes_input)=0 then raise exception 'Add at least one size quantity.'; end if;
  if exists(select 1 from jsonb_array_elements(sizes_input) as items(value) where nullif(trim(value->>'size_label'),'') is null or coalesce(value->>'quantity','') !~ '^[0-9]+$') then raise exception 'Size names and non-negative whole quantities are required.'; end if;
  select coalesce(sum((value->>'quantity')::integer),0) into calculated_total from jsonb_array_elements(sizes_input);
  if stated_total_input is not null and stated_total_input<>calculated_total and not mismatch_acknowledged_input then raise exception 'The size total differs from the PO total. Acknowledge the mismatch to save the draft.'; end if;
  insert into public.purchase_orders(buyer_id,unit_id,po_number,style,colour,ex_factory_date,stated_total,total_quantity,quantity_mismatch_acknowledged,state,created_by)
  values(buyer_id_input,unit_id_input,trim(po_number_input),trim(style_input),trim(colour_input),ex_factory_date_input,stated_total_input,calculated_total,mismatch_acknowledged_input,'draft',auth.uid()) returning id into new_order_id;
  for item in select value from jsonb_array_elements(sizes_input) loop
    insert into public.order_sizes(order_id,size_label,quantity) values(new_order_id,trim(item->>'size_label'),(item->>'quantity')::integer);
  end loop;
  return new_order_id;
end; $$;

create or replace function public.save_order_plan(
  order_id_input uuid,stage_template_id_input uuid,tna_template_id_input uuid,
  stages_input jsonb,milestones_input jsonb,release_input boolean default false,buyer_visible_input boolean default false
) returns void language plpgsql security definer set search_path=public as $$
declare
  po public.purchase_orders%rowtype; stage_item jsonb; line_item jsonb; milestone_item jsonb;
  new_stage_id uuid; submitter_id uuid; mismatch_stage text; mismatch_milestone text;
begin
  if public.current_role()<>'merchandiser' then raise exception 'Only a merchandiser can update the production plan.' using errcode='42501'; end if;
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
  select trim(stage.value->>'stage_name'),trim(stage.value->>'tna_milestone_name')
    into mismatch_stage,mismatch_milestone
    from jsonb_array_elements(stages_input) stage(value)
    where nullif(trim(stage.value->>'tna_milestone_name'),'') is not null
      and not exists(select 1 from jsonb_array_elements(milestones_input) milestone(value)
        where lower(trim(milestone.value->>'name'))=lower(trim(stage.value->>'tna_milestone_name')))
    limit 1;
  if mismatch_stage is not null then
    raise exception using errcode='P0001', message=format('Stage "%s" is linked to milestone "%s", but that milestone is not included in the selected TNA template. Choose a milestone from this TNA plan or clear the stage link.',mismatch_stage,mismatch_milestone);
  end if;
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
