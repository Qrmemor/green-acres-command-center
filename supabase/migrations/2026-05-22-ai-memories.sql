create table if not exists public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  memory_type text not null default 'lesson' check (memory_type in ('sop_rule', 'bradley_pattern', 'customer_reply', 'pricing_scope', 'service_area', 'workflow', 'lesson')),
  title text not null,
  summary text not null,
  tags text[] not null default '{}',
  source_escalation_id uuid references public.escalations(id) on delete set null,
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  is_active boolean not null default true,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_memories_type on public.ai_memories(memory_type);
create index if not exists idx_ai_memories_active on public.ai_memories(is_active);
create index if not exists idx_ai_memories_tags on public.ai_memories using gin(tags);
create index if not exists idx_ai_memories_source_escalation on public.ai_memories(source_escalation_id);

alter table public.ai_memories enable row level security;
grant select, insert, update, delete on table public.ai_memories to authenticated;

drop trigger if exists ai_memories_set_updated_at on public.ai_memories;
create trigger ai_memories_set_updated_at
before update on public.ai_memories
for each row execute function public.set_updated_at();

drop policy if exists "authenticated can manage ai memories" on public.ai_memories;
create policy "authenticated can manage ai memories"
on public.ai_memories
for all
to authenticated
using (true)
with check (true);
