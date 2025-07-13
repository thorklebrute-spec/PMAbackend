-- Migration: Add profile fields to user_profiles table
-- This migration adds profile picture, bio, and name fields to the user_profiles table

-- Add new columns to user_profiles table
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);

-- Create index for display_name for better search performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_display_name ON user_profiles(display_name);

-- Migration completed successfully
SELECT 'Migration: profile fields added to user_profiles table successfully' as status; 