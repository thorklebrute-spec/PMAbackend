-- Cache table for weekly AI coach reports.
-- Run once in Supabase SQL editor.
create table if not exists public.ai_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  report_day text not null check (report_day in ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
  personality text not null check (personality in ('balanced','drill_sergeant','supportive_mentor','data_analyst')),
  week_range text not null,
  consistency_score integer not null,
  completion_summary jsonb not null,
  coach_message text not null,
  supplements jsonb not null default '[]'::jsonb,
  generated_payload jsonb,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start, week_end, report_day, personality)
);

create index if not exists idx_ai_weekly_reports_user_created
  on public.ai_weekly_reports(user_id, created_at desc);

-- Optional RLS; server currently reads/writes with service role.
alter table public.ai_weekly_reports enable row level security;

drop policy if exists ai_weekly_reports_select_own on public.ai_weekly_reports;
create policy ai_weekly_reports_select_own
  on public.ai_weekly_reports
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists ai_weekly_reports_insert_own on public.ai_weekly_reports;
create policy ai_weekly_reports_insert_own
  on public.ai_weekly_reports
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists ai_weekly_reports_update_own on public.ai_weekly_reports;
create policy ai_weekly_reports_update_own
  on public.ai_weekly_reports
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_ai_weekly_reports_updated_at on public.ai_weekly_reports;
create trigger set_ai_weekly_reports_updated_at
before update on public.ai_weekly_reports
for each row
execute procedure public.update_updated_at_column();
