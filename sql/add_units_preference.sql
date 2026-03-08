-- Add units_preference column to user_profiles for metric/imperial toggle
-- Run this in Supabase SQL Editor

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS units_preference text NOT NULL DEFAULT 'metric';

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_units_preference_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_units_preference_check
  CHECK (units_preference IN ('metric', 'imperial'));
