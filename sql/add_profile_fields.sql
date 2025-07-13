-- Migration: Add profile fields to user_profiles table
-- This migration adds bio, display_name, and profile_picture_url columns

-- Add new columns to user_profiles table
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS display_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_display_name ON user_profiles(display_name);

-- Migration completed successfully
SELECT 'Migration: Profile fields added to user_profiles table successfully' as status; 