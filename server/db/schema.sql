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
-- Newer Supabase projects don't grant table rights to service_role by default (PostgREST gave
-- 42501 "permission denied"). The server's role only; anon/authenticated get nothing. Applied Sat 7 Nov.
grant select, insert, update, delete on public.profiles, public.contacts, public.call_results to service_role;

-- User feedback: a rating after a call, or a free note from Profile. Server-only, like the rest.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  call_id text,
  rating text check (rating in ('up', 'down')),
  comment text check (char_length(comment) <= 1000),
  source text not null check (source in ('call', 'profile')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant select, insert on public.feedback to service_role;

-- Accounts with SMS-code login (optional; anonymous devices keep working). Server-only, like the rest.
-- An account's data lives under primary_device (the first device that logged in): other linked
-- devices read and write that key, and their own rows are copied over on login.
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  primary_device uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists public.account_devices (
  account_id uuid not null references public.accounts(id) on delete cascade,
  device_id uuid not null,
  linked_at timestamptz not null default now(),
  primary key (account_id, device_id)
);
-- Session tokens are random 32 bytes; only their sha256 is stored. 30 days.
create table if not exists public.sessions (
  token_hash text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_account on public.sessions (account_id);
alter table public.accounts enable row level security;
alter table public.account_devices enable row level security;
alter table public.sessions enable row level security;
revoke all on public.accounts, public.account_devices, public.sessions from anon, authenticated;
grant select, insert, update, delete on public.accounts, public.account_devices, public.sessions to service_role;
