-- Migration: Add user_profiles table for storing onboarding data
-- This migration adds a new table to store user onboarding data

-- Create a table for user profiles with onboarding data
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  onboarding_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable Row Level Security for user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for user_profiles (drop first if they exist)
DO $$
BEGIN
    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "Users can view their own profile." ON user_profiles;
    DROP POLICY IF EXISTS "Users can insert their own profile." ON user_profiles;
    DROP POLICY IF EXISTS "Users can update their own profile." ON user_profiles;
    
    -- Create new policies
    CREATE POLICY "Users can view their own profile."
      ON user_profiles FOR SELECT
      USING (auth.uid() = id);

    CREATE POLICY "Users can insert their own profile."
      ON user_profiles FOR INSERT
      WITH CHECK (auth.uid() = id);

    CREATE POLICY "Users can update their own profile."
      ON user_profiles FOR UPDATE
      USING (auth.uid() = id);
END $$;

-- Create trigger for user_profiles table updated_at
DROP TRIGGER IF EXISTS set_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER set_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_id ON user_profiles(id);

-- Migration completed successfully
SELECT 'Migration: user_profiles table added successfully' as status; 