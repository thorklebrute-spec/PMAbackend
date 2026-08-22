-- Migration: track guest trial start to prevent double trials (guest + Stripe)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS guest_trial_started_at TIMESTAMPTZ;

SELECT 'Migration: guest_trial_started_at column added successfully' AS status;
