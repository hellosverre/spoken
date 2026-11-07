-- Spoken on Supabase (project "Spoken", ref txyzvjmfdnrhrprzjmdc, eu-west-1).
-- Applied 2026-11-07 12:20. The server is the only client (service role); RLS is on with no
-- policies, so the anon key can read nothing. No transcripts or audio are stored, by design.
create table if not exists public.profiles (
  device_id uuid primary key,
  name text not null default '',
  phone text, address text, email text, allergies text,
  hear_call boolean not null default true,
  voice_id text,
  personality text not null default 'warm' check (personality in ('warm','neutral','short')),
  lang text not null default 'no' check (lang in ('no','en')),
  updated_at timestamptz not null default now()
);
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  name text not null,
  phone text not null,
  kind text not null default 'business' check (kind in ('business','person')),
  created_at timestamptz not null default now()
);
create index if not exists contacts_device on public.contacts(device_id);
create table if not exists public.call_results (
  call_id text primary key,
  device_id uuid not null,
  task_id text not null,
  callee_name text,
  outcome text not null check (outcome in ('done','partial','failed','refused','no_answer')),
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  duration_sec integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists call_results_device on public.call_results(device_id, created_at desc);
alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.call_results enable row level security;
