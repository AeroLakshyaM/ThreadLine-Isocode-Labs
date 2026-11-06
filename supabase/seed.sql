-- Development seed only. All names and configurations below are synthetic examples.
-- Do not apply this file to a live Company A project without reviewing each row.
insert into public.buyers(name) values
  ('Northstar Kids'),('Harbor & Pine'),('Westwind Studio')
on conflict(name) do nothing;

insert into public.production_units(name,timezone,working_days) values
  ('Demo Unit 01 · Avinashi','Asia/Kolkata',array[]::smallint[]),
  ('Demo Unit 02 · Tiruppur','Asia/Kolkata',array[]::smallint[]),
  ('Demo Unit 03 · Palladam','Asia/Kolkata',array[]::smallint[])
on conflict(name) do nothing;

with unit as (select id from public.production_units where name='Demo Unit 01 · Avinashi' limit 1)
insert into public.production_lines(unit_id,name)
select unit.id,line.name from unit cross join (values('Line A'),('Line B'),('Line C')) as line(name)
on conflict(unit_id,name) do nothing;

with unit as (select id from public.production_units where name='Demo Unit 01 · Avinashi' limit 1), template as (
  insert into public.stage_templates(unit_id,name,version,active)
  select unit.id,'Illustrative knitwear route · review before use',1,false from unit
  on conflict(unit_id,name,version) do update set active=false returning id
)
insert into public.stage_template_steps(template_id,stage_name,sequence_no,default_applicable)
select template.id,step.stage_name,step.sequence_no,true from template cross join (values
  ('Cutting',1),('Stitching',2),('Printing / finishing',3),('Quality check',4),('Packing',5)
) as step(stage_name,sequence_no)
on conflict(template_id,sequence_no) do nothing;

with unit as (select id from public.production_units where name='Demo Unit 01 · Avinashi' limit 1)
insert into public.tna_templates(unit_id,name,version,date_basis,active)
select unit.id,'Illustrative export schedule · review before use',1,'ex_factory_offset',false from unit
on conflict(unit_id,name,version) do update set active=false;
