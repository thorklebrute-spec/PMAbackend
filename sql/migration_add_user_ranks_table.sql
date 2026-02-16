-- Migration: Create user_ranks table for rank system
-- This migration creates a new table to store user rank and points data

-- Create user_ranks table
CREATE TABLE IF NOT EXISTS user_ranks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  total_points INTEGER DEFAULT 0 NOT NULL,
  current_rank TEXT DEFAULT 'Bronze I' NOT NULL,
  rank_tier TEXT DEFAULT 'BRONZE' NOT NULL,
  rank_level INTEGER DEFAULT 1 NOT NULL,
  points_earned_today INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  points_to_next_rank INTEGER DEFAULT 250,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(user_id)
);

-- Enable Row Level Security for user_ranks
ALTER TABLE user_ranks ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then create new ones
DROP POLICY IF EXISTS "Users can view their own rank data." ON user_ranks;
DROP POLICY IF EXISTS "Users can insert their own rank data." ON user_ranks;
DROP POLICY IF EXISTS "Users can update their own rank data." ON user_ranks;

CREATE POLICY "Users can view their own rank data."
  ON user_ranks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own rank data."
  ON user_ranks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rank data."
  ON user_ranks FOR UPDATE
  USING (auth.uid() = user_id);

-- Create trigger for user_ranks table updated_at
DROP TRIGGER IF EXISTS set_user_ranks_updated_at ON user_ranks;
CREATE TRIGGER set_user_ranks_updated_at
  BEFORE UPDATE ON user_ranks
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_ranks_user_id ON user_ranks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ranks_total_points ON user_ranks(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_user_ranks_rank_tier ON user_ranks(rank_tier);

-- Migration completed successfully
SELECT 'Migration: user_ranks table created successfully' as status;
