-- Create a table for user profiles
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE,
  email TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  PRIMARY KEY (id)
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY IF NOT EXISTS "Public profiles are viewable by everyone."
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY IF NOT EXISTS "Users can insert their own profile."
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY IF NOT EXISTS "Users can update their own profile."
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Create a trigger to handle updated_at
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

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

-- Create policies for lifestyle_scores
CREATE POLICY IF NOT EXISTS "Users can view their own lifestyle scores."
  ON lifestyle_scores FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can insert their own lifestyle scores."
  ON lifestyle_scores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

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

-- Create policies for daily_missions
CREATE POLICY IF NOT EXISTS "Users can view their own daily missions."
  ON daily_missions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can insert their own daily missions."
  ON daily_missions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can update their own daily missions."
  ON daily_missions FOR UPDATE
  USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_daily_missions_user_date ON daily_missions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_lifestyle_scores_user_created ON lifestyle_scores(user_id, created_at);

-- Create a table for progress tracking (legacy - keeping for backward compatibility)
CREATE TABLE IF NOT EXISTS progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  health_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(user_id, date)
);

-- Enable Row Level Security for progress
ALTER TABLE progress ENABLE ROW LEVEL SECURITY;

-- Create policies for progress
CREATE POLICY IF NOT EXISTS "Users can view their own progress."
  ON progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can insert their own progress."
  ON progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can update their own progress."
  ON progress FOR UPDATE
  USING (auth.uid() = user_id);

-- Create index for progress
CREATE INDEX IF NOT EXISTS idx_progress_user_date ON progress(user_id, date);
