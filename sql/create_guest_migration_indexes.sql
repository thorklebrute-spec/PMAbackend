-- Optional helper for robust guest migration upserts.
-- Run in Supabase SQL editor if these constraints/indexes are not present.

-- 1) Ensure idempotent upserts can target (user_id, date).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_missions_user_id_date_key'
  ) then
    alter table public.daily_missions
      add constraint daily_missions_user_id_date_key unique (user_id, date);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'progress_user_id_date_key'
  ) then
    alter table public.progress
      add constraint progress_user_id_date_key unique (user_id, date);
  end if;
end $$;

create index if not exists idx_daily_missions_user_date
  on public.daily_missions(user_id, date desc);

create index if not exists idx_progress_user_date
  on public.progress(user_id, date desc);

-- 2) Optional profile columns for AI coach preferences persisted from guest payload.
alter table public.user_profiles
  add column if not exists ai_coach_report_day text
  check (
    ai_coach_report_day is null
    or ai_coach_report_day in (
      'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
    )
  );

alter table public.user_profiles
  add column if not exists ai_coach_personality text
  check (
    ai_coach_personality is null
    or ai_coach_personality in (
      'balanced', 'drill_sergeant', 'supportive_mentor', 'data_analyst'
    )
  );
