-- Migration: Create daily_points table for rank point history
-- This migration creates a table to track daily point breakdowns per user

CREATE TABLE IF NOT EXISTS daily_points (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  mission_points INTEGER DEFAULT 0,
  streak_bonus INTEGER DEFAULT 0,
  progress_points INTEGER DEFAULT 0,
  lifestyle_bonus INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(user_id, date)
);

-- Enable Row Level Security
ALTER TABLE daily_points ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Users can view their own daily points." ON daily_points;
DROP POLICY IF EXISTS "Users can insert their own daily points." ON daily_points;
DROP POLICY IF EXISTS "Users can update their own daily points." ON daily_points;

CREATE POLICY "Users can view their own daily points."
  ON daily_points FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own daily points."
  ON daily_points FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own daily points."
  ON daily_points FOR UPDATE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_points_user_id ON daily_points(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_points_date ON daily_points(date);
CREATE INDEX IF NOT EXISTS idx_daily_points_user_date ON daily_points(user_id, date);

SELECT 'Migration: daily_points table created successfully' as status;
