create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text,
  role text check (role in ('poster', 'tech', 'admin')) default 'tech',
  skills text[] default '{}',
  trusted boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text,
  event_date text,
  location text,
  call_time text,
  finish_time text,
  role_needed text,
  rate text,
  notes text,
  posted_by_phone text not null,
  posted_by_name text,
  status text check (status in ('draft', 'open', 'closed', 'cancelled')) default 'draft',
  created_at timestamptz default now()
);

create table if not exists public.job_responses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  tech_phone text not null,
  tech_name text,
  response text check (response in ('yes', 'no', 'maybe')) not null,
  created_at timestamptz default now(),
  unique(job_id, tech_phone)
);

create table if not exists public.conversation_states (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  state text not null,
  data jsonb default '{}',
  updated_at timestamptz default now()
);

create table if not exists public.processed_messages (
  id uuid primary key default gen_random_uuid(),
  whatsapp_message_id text unique not null,
  created_at timestamptz default now()
);

create table if not exists public.job_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  tech_phone text not null,
  sent_at timestamptz default now(),
  unique(job_id, tech_phone)
);

create index if not exists idx_users_phone on public.users(phone);
create index if not exists idx_users_role_trusted on public.users(role, trusted);
create index if not exists idx_jobs_status_created_at on public.jobs(status, created_at desc);
create index if not exists idx_jobs_posted_by_phone on public.jobs(posted_by_phone);
create index if not exists idx_job_responses_job_id on public.job_responses(job_id);
create index if not exists idx_job_responses_tech_phone on public.job_responses(tech_phone);
create index if not exists idx_conversation_states_phone on public.conversation_states(phone);
create index if not exists idx_processed_messages_message_id on public.processed_messages(whatsapp_message_id);
create index if not exists idx_job_deliveries_job_id on public.job_deliveries(job_id);
create index if not exists idx_job_deliveries_tech_phone_sent_at on public.job_deliveries(tech_phone, sent_at desc);
