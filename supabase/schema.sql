-- Green Acres Command Center
-- Run this in Supabase SQL Editor after creating the project.

create extension if not exists "pgcrypto";

-- USERS ---------------------------------------------------------
create table if not exists public.users_profile (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'carl' check (role in ('carl', 'bradley', 'admin')),
  created_at timestamptz not null default now()
);

-- ESCALATIONS ---------------------------------------------------
create table if not exists public.escalations (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  address text,
  phone text,
  email text,
  source text not null default 'Quo',
  source_detail text,
  call_link text,
  thread_link text,
  where_to_continue text not null,
  urgency text not null default 'Standard / Non-Urgent' check (urgency in ('Urgent / Customer-Sensitive', 'Standard / Non-Urgent')),
  topic text not null default 'Other',
  situation text not null,
  last_touch text not null,
  reason_for_escalation text not null,
  proposed_next_step text not null,
  bradley_note text,
  status text not null default 'Needs Bradley',
  follow_up_date date,
  owner_next_action text not null default 'Bradley' check (owner_next_action in ('Carl', 'Bradley', 'Customer')),
  created_by uuid references public.users_profile(id) on delete set null,
  assigned_to uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint unresolved_requires_followup check (
    status in ('Resolved', 'Closed', 'Not a Fit') or follow_up_date is not null
  )
);

-- ACTIVITY LOGS -------------------------------------------------
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid not null references public.escalations(id) on delete cascade,
  action_type text not null,
  note text,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now()
);

-- COMMENTS ------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid not null references public.escalations(id) on delete cascade,
  comment text not null,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now()
);


-- ESCALATION ATTACHMENTS ----------------------------------------
create table if not exists public.escalation_attachments (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid not null references public.escalations(id) on delete cascade,
  attachment_category text not null default 'estimate' check (attachment_category in ('estimate', 'needs_more_info')),
  file_name text not null,
  file_path text not null,
  file_url text not null,
  file_type text,
  file_size integer,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now()
);

-- STORAGE BUCKET ------------------------------------------------
insert into storage.buckets (id, name, public)
values ('estimate-photos', 'estimate-photos', true)
on conflict (id) do update set public = true;

-- SAVED REPORTS -------------------------------------------------
create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('SOD', 'EOD')),
  report_date date not null,
  content text not null,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now()
);

-- SETTINGS OPTIONS ----------------------------------------------
-- Extra MVP table so Carl can manage source/topic/status options from the Settings page.
create table if not exists public.settings_options (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('source', 'topic', 'status')),
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (category, label)
);

-- UPDATED_AT TRIGGER --------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists escalations_set_updated_at on public.escalations;
create trigger escalations_set_updated_at
before update on public.escalations
for each row execute function public.set_updated_at();

-- USER PROFILE TRIGGER ------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users_profile (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'role', 'carl')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.users_profile.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ROLE HELPER ----------------------------------------------------
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users_profile where id = auth.uid();
$$;

-- INDEXES -------------------------------------------------------
create index if not exists idx_escalations_status on public.escalations(status);
create index if not exists idx_escalations_urgency on public.escalations(urgency);
create index if not exists idx_escalations_source on public.escalations(source);
create index if not exists idx_escalations_follow_up_date on public.escalations(follow_up_date);
create index if not exists idx_escalations_resolved_at on public.escalations(resolved_at);
create index if not exists idx_activity_logs_escalation_id on public.activity_logs(escalation_id);
create index if not exists idx_comments_escalation_id on public.comments(escalation_id);
create index if not exists idx_escalation_attachments_escalation_id on public.escalation_attachments(escalation_id);
create index if not exists idx_escalation_attachments_category on public.escalation_attachments(attachment_category);
create index if not exists idx_settings_options_category on public.settings_options(category);

-- RLS -----------------------------------------------------------
alter table public.users_profile enable row level security;
alter table public.escalations enable row level security;
alter table public.activity_logs enable row level security;
alter table public.comments enable row level security;
alter table public.escalation_attachments enable row level security;
alter table public.saved_reports enable row level security;
alter table public.settings_options enable row level security;

-- Drop old policies for repeatable setup.
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('users_profile', 'escalations', 'activity_logs', 'comments', 'escalation_attachments', 'saved_reports', 'settings_options')
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;


drop policy if exists "authenticated read estimate photos" on storage.objects;
drop policy if exists "authenticated upload estimate photos" on storage.objects;
drop policy if exists "authenticated update estimate photos" on storage.objects;
drop policy if exists "authenticated delete estimate photos" on storage.objects;


-- Estimate photo storage policies
create policy "authenticated read estimate photos"
on storage.objects
for select
using (bucket_id = 'estimate-photos' and auth.role() = 'authenticated');

create policy "authenticated upload estimate photos"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'estimate-photos');

create policy "authenticated update estimate photos"
on storage.objects
for update
to authenticated
using (bucket_id = 'estimate-photos')
with check (bucket_id = 'estimate-photos');

create policy "authenticated delete estimate photos"
on storage.objects
for delete
to authenticated
using (bucket_id = 'estimate-photos');

-- Profiles
create policy "authenticated read profiles"
on public.users_profile
for select
to authenticated
using (true);

create policy "users update own profile or admins update any"
on public.users_profile
for update
to authenticated
using (id = auth.uid() or public.current_profile_role() = 'admin')
with check (id = auth.uid() or public.current_profile_role() = 'admin');

create policy "users insert own profile"
on public.users_profile
for insert
to authenticated
with check (id = auth.uid());

-- Escalations
create policy "team read escalations"
on public.escalations
for select
to authenticated
using (public.current_profile_role() in ('carl', 'bradley', 'admin'));

create policy "carl and admin create escalations"
on public.escalations
for insert
to authenticated
with check (public.current_profile_role() in ('carl', 'admin'));

create policy "team update escalations"
on public.escalations
for update
to authenticated
using (public.current_profile_role() in ('carl', 'bradley', 'admin'))
with check (public.current_profile_role() in ('carl', 'bradley', 'admin'));

create policy "carl and admin delete escalations"
on public.escalations
for delete
to authenticated
using (public.current_profile_role() in ('carl', 'admin'));

-- Activity logs
create policy "team read activity logs"
on public.activity_logs
for select
to authenticated
using (public.current_profile_role() in ('carl', 'bradley', 'admin'));

create policy "team create activity logs"
on public.activity_logs
for insert
to authenticated
with check (public.current_profile_role() in ('carl', 'bradley', 'admin'));

-- Comments
create policy "team read comments"
on public.comments
for select
to authenticated
using (public.current_profile_role() in ('carl', 'bradley', 'admin'));

create policy "team create comments"
on public.comments
for insert
to authenticated
with check (public.current_profile_role() in ('carl', 'bradley', 'admin'));

create policy "carl and admin delete comments"
on public.comments
for delete
to authenticated
using (public.current_profile_role() in ('carl', 'admin'));


-- Escalation attachments
create policy "team read escalation attachments"
on public.escalation_attachments
for select
to authenticated
using (public.current_profile_role() in ('carl', 'bradley', 'admin'));

create policy "carl and admin create escalation attachments"
on public.escalation_attachments
for insert
to authenticated
with check (public.current_profile_role() in ('carl', 'admin'));

create policy "carl and admin delete escalation attachments"
on public.escalation_attachments
for delete
to authenticated
using (public.current_profile_role() in ('carl', 'admin'));

-- Saved reports
create policy "team read saved reports"
on public.saved_reports
for select
to authenticated
using (public.current_profile_role() in ('carl', 'bradley', 'admin'));

create policy "carl and admin create reports"
on public.saved_reports
for insert
to authenticated
with check (public.current_profile_role() in ('carl', 'admin'));

create policy "carl and admin delete reports"
on public.saved_reports
for delete
to authenticated
using (public.current_profile_role() in ('carl', 'admin'));

-- Settings options
create policy "team read settings options"
on public.settings_options
for select
to authenticated
using (public.current_profile_role() in ('carl', 'bradley', 'admin'));

create policy "carl and admin manage settings options insert"
on public.settings_options
for insert
to authenticated
with check (public.current_profile_role() in ('carl', 'admin'));

create policy "carl and admin manage settings options update"
on public.settings_options
for update
to authenticated
using (public.current_profile_role() in ('carl', 'admin'))
with check (public.current_profile_role() in ('carl', 'admin'));

create policy "carl and admin manage settings options delete"
on public.settings_options
for delete
to authenticated
using (public.current_profile_role() in ('carl', 'admin'));

-- SEED OPTIONS --------------------------------------------------
insert into public.settings_options (category, label, sort_order) values
('source', 'Quo', 10),
('source', 'HomeWorks', 20),
('source', 'Gmail', 30),
('source', 'Other', 40),
('topic', 'Pricing', 10),
('topic', 'Refund', 20),
('topic', 'Call Needed', 30),
('topic', 'Complaint', 40),
('topic', 'Scheduling', 50),
('topic', 'Estimate', 60),
('topic', 'Scope', 70),
('topic', 'Payment', 80),
('topic', 'Referral', 90),
('topic', 'Turf Program', 100),
('topic', 'Mowing', 110),
('topic', 'Website Purchase', 120),
('topic', 'Other', 130),
('status', 'Needs Bradley', 10),
('status', 'Waiting on Bradley', 20),
('status', 'Waiting on Customer', 30),
('status', 'Bradley Replied', 40),
('status', 'Approved', 50),
('status', 'Ready for Carl', 55),
('status', 'Follow-Up Needed', 60),
('status', 'Resolved', 70),
('status', 'Closed', 80),
('status', 'Not a Fit', 90)
on conflict (category, label) do nothing;
