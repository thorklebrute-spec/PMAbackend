-- Rank System Database Schema

-- User ranks table
CREATE TABLE IF NOT EXISTS user_ranks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    total_points INTEGER DEFAULT 0 NOT NULL,
    current_rank VARCHAR(20) DEFAULT 'Bronze I' NOT NULL,
    rank_tier VARCHAR(20) DEFAULT 'BRONZE' NOT NULL,
    rank_level INTEGER DEFAULT 1 NOT NULL,
    points_earned_today INTEGER DEFAULT 0 NOT NULL,
    streak_days INTEGER DEFAULT 0 NOT NULL,
    points_to_next_rank INTEGER DEFAULT 250 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Daily points history table
CREATE TABLE IF NOT EXISTS daily_points (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    date DATE NOT NULL,
    mission_points INTEGER DEFAULT 0 NOT NULL,
    streak_bonus INTEGER DEFAULT 0 NOT NULL,
    progress_points INTEGER DEFAULT 0 NOT NULL,
    lifestyle_bonus INTEGER DEFAULT 0 NOT NULL,
    total_points INTEGER DEFAULT 0 NOT NULL,
    streak_days INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE(user_id, date)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_ranks_user_id ON user_ranks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ranks_total_points ON user_ranks(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_daily_points_user_id ON daily_points(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_points_date ON daily_points(date);
CREATE INDEX IF NOT EXISTS idx_daily_points_user_date ON daily_points(user_id, date);

-- Enable Row Level Security (RLS)
ALTER TABLE user_ranks ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_points ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_ranks
CREATE POLICY "Users can view their own rank" ON user_ranks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own rank" ON user_ranks
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own rank" ON user_ranks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for daily_points
CREATE POLICY "Users can view their own daily points" ON daily_points
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own daily points" ON daily_points
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own daily points" ON daily_points
    FOR UPDATE USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_user_ranks_updated_at 
    BEFORE UPDATE ON user_ranks 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial rank for existing users (run this after creating the table)
-- INSERT INTO user_ranks (user_id, total_points, current_rank, rank_tier, rank_level, points_to_next_rank)
-- SELECT id, 0, 'Bronze I', 'BRONZE', 1, 250
-- FROM auth.users
-- WHERE id NOT IN (SELECT user_id FROM user_ranks); 