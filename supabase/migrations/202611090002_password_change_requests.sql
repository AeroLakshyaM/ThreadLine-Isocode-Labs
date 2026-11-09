-- User-visible profiles with administrator-managed password-change requests.
-- Apply after the initial schema; this migration is separate from the broader stabilisation migration.

create table public.password_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_note text check (request_note is null or char_length(request_note) <= 1000),
  status text not null default 'pending' check (status in ('pending','completed','declined')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz
);
create unique index password_change_requests_one_pending_per_user
  on public.password_change_requests(user_id) where status='pending';

alter table public.password_change_requests enable row level security;
grant select,insert,update on public.password_change_requests to authenticated;

create policy "users read own password requests" on public.password_change_requests
  for select using (user_id=auth.uid() or public.current_role()='admin');
create policy "users request own password change" on public.password_change_requests
  for insert with check (user_id=auth.uid() and public.current_role() is not null and status='pending');
create policy "admins review password requests" on public.password_change_requests
  for update using (public.current_role()='admin')
  with check (public.current_role()='admin');

create trigger audit_password_change_requests after insert or update on public.password_change_requests
  for each row execute function public.audit_row_change();
