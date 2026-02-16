-- Migration: Add Primal Apex rank tier
-- This migration documents the updated rank system with the Primal Apex tier

-- The rank system now supports:
-- BRONZE: 0-1999 points
-- SILVER: 2000-4999 points  
-- GOLD: 5000-9999 points
-- PLATINUM: 10000-19999 points
-- DIAMOND: 20000-39999 points
-- PRIMAL_APEX: 40000+ points

-- Note: The actual rank calculation logic is handled in rankSystem.js
-- The existing user_ranks table structure supports the new tier without schema changes
-- Users reaching 40000+ points will be assigned the Primal Apex rank
