-- Migration: Add daily_missions and lifestyle_scores tables
-- This migration adds new tables to the existing schema without affecting existing tables

-- Create a table for lifestyle scores
CREATE TABLE IF NOT EXISTS lifestyle_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  overall_score INTEGER NOT NULL,
  yearly_decline_rate DECIMAL(5,2) NOT NULL,
  impact_multiplier DECIMAL(5,2) NOT NULL,
  factor_scores JSONB NOT NULL,
  factor_descriptions JSONB NOT NULL,
  recommendations JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable Row Level Security for lifestyle_scores
ALTER TABLE lifestyle_scores ENABLE ROW LEVEL SECURITY;

-- Create policies for lifestyle_scores (drop first if they exist)
DO $$
BEGIN
    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "Users can view their own lifestyle scores." ON lifestyle_scores;
    DROP POLICY IF EXISTS "Users can insert their own lifestyle scores." ON lifestyle_scores;
    
    -- Create new policies
    CREATE POLICY "Users can view their own lifestyle scores."
      ON lifestyle_scores FOR SELECT
      USING (auth.uid() = user_id);

    CREATE POLICY "Users can insert their own lifestyle scores."
      ON lifestyle_scores FOR INSERT
      WITH CHECK (auth.uid() = user_id);
END $$;

-- Create a table for daily mission progress (testosterone-boosting activities)
CREATE TABLE IF NOT EXISTS daily_missions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  sleep_completed BOOLEAN DEFAULT false,
  exercise_completed BOOLEAN DEFAULT false,
  sunlight_completed BOOLEAN DEFAULT false,
  diet_completed BOOLEAN DEFAULT false,
  alcohol_avoided BOOLEAN DEFAULT false,
  cold_exposure_completed BOOLEAN DEFAULT false,
  no_porn_masturbation BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(user_id, date)
);

-- Enable Row Level Security for daily_missions
ALTER TABLE daily_missions ENABLE ROW LEVEL SECURITY;

-- Create policies for daily_missions (drop first if they exist)
DO $$
BEGIN
    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "Users can view their own daily missions." ON daily_missions;
    DROP POLICY IF EXISTS "Users can insert their own daily missions." ON daily_missions;
    DROP POLICY IF EXISTS "Users can update their own daily missions." ON daily_missions;
    
    -- Create new policies
    CREATE POLICY "Users can view their own daily missions."
      ON daily_missions FOR SELECT
      USING (auth.uid() = user_id);

    CREATE POLICY "Users can insert their own daily missions."
      ON daily_missions FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "Users can update their own daily missions."
      ON daily_missions FOR UPDATE
      USING (auth.uid() = user_id);
END $$;

-- Create trigger for daily_missions table updated_at
DROP TRIGGER IF EXISTS set_daily_missions_updated_at ON daily_missions;
CREATE TRIGGER set_daily_missions_updated_at
  BEFORE UPDATE ON daily_missions
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_daily_missions_user_date ON daily_missions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_lifestyle_scores_user_created ON lifestyle_scores(user_id, created_at);

-- Migration completed successfully
SELECT 'Migration: daily_missions and lifestyle_scores tables added successfully' as status; 