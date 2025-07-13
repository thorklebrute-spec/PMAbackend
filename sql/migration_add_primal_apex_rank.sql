-- Migration: Add Primal Apex rank tier
-- This migration updates the rank system to include the new Primal Apex tier

-- Update existing Diamond tier to have a max of 19999 instead of Infinity
-- This will be handled by the application logic, but we can add a comment here

-- The rank system now supports:
-- BRONZE: 0-999 points
-- SILVER: 1000-2999 points  
-- GOLD: 3000-5999 points
-- PLATINUM: 6000-9999 points
-- DIAMOND: 10000-19999 points
-- PRIMAL_APEX: 20000+ points

-- Note: The actual rank calculation logic is handled in the application
-- This migration serves as documentation of the new rank structure

-- Optional: Add any database constraints or indexes if needed
-- For now, the existing user_ranks table structure supports the new tier

-- Migration completed successfully
-- The application will automatically handle the new Primal Apex tier
-- Users reaching 20000+ points will be assigned the Primal Apex rank 