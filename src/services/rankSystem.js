import { supabaseAdmin } from '../config/supabase.js';
import { MISSION_FIELDS, MISSION_FIELD_COUNT } from '../constants/missions.js';

// Rank tiers configuration
const RANK_TIERS = {
  BRONZE: { min: 0, max: 1999, name: 'Bronze' },
  SILVER: { min: 2000, max: 4999, name: 'Silver' },
  GOLD: { min: 5000, max: 9999, name: 'Gold' },
  PLATINUM: { min: 10000, max: 19999, name: 'Platinum' },
  DIAMOND: { min: 20000, max: 39999, name: 'Diamond' },
  PRIMAL_APEX: { min: 40000, max: Infinity, name: 'Primal Apex' }
};

// Calculate rank from points
const calculateRank = (points) => {
  const tier = Object.entries(RANK_TIERS).find(([key, config]) => 
    points >= config.min && points <= config.max
  );
  
  if (!tier) return { tier: 'PRIMAL_APEX', level: 1, name: 'Primal Apex' };
  
  const [tierKey, config] = tier;
  
  // Special handling for Primal Apex (only one level)
  if (tierKey === 'PRIMAL_APEX') {
    return {
      tier: tierKey,
      level: 1,
      name: config.name
    };
  }
  
  const tierRange = config.max - config.min + 1;
  const level = Math.floor(((points - config.min) / tierRange) * 4) + 1;
  
  return {
    tier: tierKey,
    level: Math.min(level, 4),
    name: `${config.name} ${level === 1 ? 'I' : level === 2 ? 'II' : level === 3 ? 'III' : 'IV'}`
  };
};

// Calculate points from daily missions
const calculateMissionPoints = (missions) => {
  const completedMissions = MISSION_FIELDS.filter(field => missions[field]).length;
  
  let points = completedMissions * 5; // 5 points per mission (was 10)
  
  // Perfect day bonus (all missions completed)
  if (completedMissions === MISSION_FIELD_COUNT) {
    points += 25; // 25 bonus (was 50)
  }
  
  return points;
};

// Calculate streak bonus
const calculateStreakBonus = (streakDays) => {
  return Math.min(streakDays * 10, 100); // Max 100 points for streak
};

// Calculate progress improvement points
const calculateProgressPoints = (currentProgress, previousProgress) => {
  if (!previousProgress) return 0;
  
  let points = 0;
  const metrics = ['testosterone', 'spermCount', 'strength'];
  
  metrics.forEach(metric => {
    const current = parseFloat(currentProgress[metric] || 0);
    const previous = parseFloat(previousProgress[metric] || 0);
    
    if (current > previous) {
      points += 5; // 5 points per metric improvement
    }
  });
  
  return points;
};

// Calculate lifestyle score bonus
const calculateLifestyleBonus = (lifestyleScore) => {
  if (lifestyleScore >= 80) {
    return Math.floor(lifestyleScore); // 1 point per lifestyle score point
  }
  return 0;
};

// Get user's current streak
const getUserStreak = async (userId) => {
  try {
    const { data: missions, error } = await supabaseAdmin
      .from('daily_missions')
      .select(`date, ${MISSION_FIELDS.join(', ')}`)
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(30); // Check last 30 days

    if (error) throw error;

    let streak = 0;
    const today = new Date().toISOString().split('T')[0];
    
    for (let i = 0; i < missions.length; i++) {
      const mission = missions[i];
      const completedMissions = MISSION_FIELDS.filter(field => mission[field]).length;
      
      // Count as completed if at least 5 missions are done
      if (completedMissions >= 5) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  } catch (error) {
    console.error('Error calculating user streak:', error);
    return 0;
  }
};

// Calculate daily points for a user
export const calculateDailyPoints = async (userId, date, missions, lifestyleScore = null) => {
  try {
    // Base mission points
    const missionPoints = calculateMissionPoints(missions);
    
    // Streak bonus
    const streak = await getUserStreak(userId);
    const streakBonus = calculateStreakBonus(streak);
    
    // Progress improvement points (compare with previous day)
    const previousDate = new Date(date);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousDateStr = previousDate.toISOString().split('T')[0];
    
    const { data: previousProgress } = await supabaseAdmin
      .from('progress')
      .select('health_data')
      .eq('user_id', userId)
      .eq('date', previousDateStr)
      .single();
    
    let progressPoints = 0;
    if (previousProgress) {
      const currentProgress = {
        testosterone: missions.health_data?.find(h => h.label === 'Testosterone')?.value,
        spermCount: missions.health_data?.find(h => h.label === 'Sperm Count')?.value,
        strength: missions.health_data?.find(h => h.label === 'Strength')?.value
      };
      
      const previousMetrics = {
        testosterone: previousProgress.health_data?.find(h => h.label === 'Testosterone')?.value,
        spermCount: previousProgress.health_data?.find(h => h.label === 'Sperm Count')?.value,
        strength: previousProgress.health_data?.find(h => h.label === 'Strength')?.value
      };
      
      progressPoints = calculateProgressPoints(currentProgress, previousMetrics);
    }
    
    // Lifestyle score bonus
    const lifestyleBonus = lifestyleScore ? calculateLifestyleBonus(lifestyleScore) : 0;
    
    const totalPoints = missionPoints + streakBonus + progressPoints + lifestyleBonus;
    // Cap total points per day to 50
    const cappedTotalPoints = Math.min(totalPoints, 50);
    
    return {
      missionPoints,
      streakBonus,
      progressPoints,
      lifestyleBonus,
      totalPoints: cappedTotalPoints,
      streak
    };
  } catch (error) {
    console.error('Error calculating daily points:', error);
    return {
      missionPoints: 0,
      streakBonus: 0,
      progressPoints: 0,
      lifestyleBonus: 0,
      totalPoints: 0,
      streak: 0
    };
  }
};

// Update user's rank and points
export const updateUserRank = async (userId, pointsEarned) => {
  try {
    // Get current user rank data
    const { data: currentRank, error: fetchError } = await supabaseAdmin
      .from('user_ranks')
      .select('*')
      .eq('user_id', userId)
      .single();

    const currentPoints = currentRank?.total_points || 0;
    const newTotalPoints = currentPoints + pointsEarned;
    const newRank = calculateRank(newTotalPoints);
    
    // Calculate points to next rank
    const currentTier = RANK_TIERS[newRank.tier];
    const pointsInCurrentTier = newTotalPoints - currentTier.min;
    const pointsNeededForNextLevel = Math.ceil((currentTier.max - currentTier.min) / 4);
    const pointsToNextRank = pointsNeededForNextLevel - (pointsInCurrentTier % pointsNeededForNextLevel);
    
    const rankData = {
      user_id: userId,
      total_points: newTotalPoints,
      current_rank: newRank.name,
      rank_tier: newRank.tier,
      rank_level: newRank.level,
      points_earned_today: pointsEarned,
      streak_days: currentRank?.streak_days || 0,
      points_to_next_rank: pointsToNextRank,
      updated_at: new Date().toISOString()
    };

    // Upsert rank data
    const { data: updatedRank, error: updateError } = await supabaseAdmin
      .from('user_ranks')
      .upsert([rankData], { onConflict: 'user_id' })
      .select()
      .single();

    if (updateError) throw updateError;

    return {
      success: true,
      rank: updatedRank,
      pointsEarned,
      newTotalPoints,
      rankInfo: newRank
    };
  } catch (error) {
    console.error('Error updating user rank:', error);
    throw error;
  }
};

// Get user's rank information
export const getUserRank = async (userId) => {
  try {
    const { data: rankData, error } = await supabaseAdmin
      .from('user_ranks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!rankData) {
      // Create initial rank for new user
      const initialRank = calculateRank(0);
      const { data: newRank, error: createError } = await supabaseAdmin
        .from('user_ranks')
        .insert([{
          user_id: userId,
          total_points: 0,
          current_rank: initialRank.name,
          rank_tier: initialRank.tier,
          rank_level: initialRank.level,
          points_earned_today: 0,
          streak_days: 0,
          points_to_next_rank: 250, // Points needed for Bronze II
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (createError) throw createError;
      return newRank;
    }

    return rankData;
  } catch (error) {
    console.error('Error getting user rank:', error);
    throw error;
  }
};

// Get leaderboard (top users by points)
export const getLeaderboard = async (limit = 10) => {
  try {
    const { data: leaderboard, error } = await supabaseAdmin
      .from('user_ranks')
      .select(`
        user_id,
        total_points,
        current_rank,
        rank_tier,
        rank_level,
        streak_days,
        user_profiles!inner(display_name, onboarding_data)
      `)
      .order('total_points', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return leaderboard.map((entry, index) => ({
      rank: index + 1,
      userId: entry.user_id,
      totalPoints: entry.total_points,
      currentRank: entry.current_rank,
      rankTier: entry.rank_tier,
      rankLevel: entry.rank_level,
      streakDays: entry.streak_days,
      displayName: entry.user_profiles?.display_name
        || entry.user_profiles?.onboarding_data?.displayName
        || `User ${entry.user_id.slice(0, 8)}`
    }));
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    throw error;
  }
};

// Process daily rank update (called when missions are completed)
export const processDailyRankUpdate = async (userId, date, missions, lifestyleScore = null) => {
  try {
    console.log('🏆 Processing daily rank update for user:', userId);
    
    // Calculate points for today
    const dailyPoints = await calculateDailyPoints(userId, date, missions, lifestyleScore);
    
    // Update user's rank
    const rankUpdate = await updateUserRank(userId, dailyPoints.totalPoints);
    
    // Save daily points history
    await supabaseAdmin
      .from('daily_points')
      .upsert([{
        user_id: userId,
        date: date,
        mission_points: dailyPoints.missionPoints,
        streak_bonus: dailyPoints.streakBonus,
        progress_points: dailyPoints.progressPoints,
        lifestyle_bonus: dailyPoints.lifestyleBonus,
        total_points: dailyPoints.totalPoints,
        streak_days: dailyPoints.streak,
        created_at: new Date().toISOString()
      }], { onConflict: 'user_id,date' });

    console.log('✅ Daily rank update completed:', {
      userId,
      pointsEarned: dailyPoints.totalPoints,
      newTotalPoints: rankUpdate.newTotalPoints,
      newRank: rankUpdate.rankInfo.name
    });

    return rankUpdate;
  } catch (error) {
    console.error('❌ Error processing daily rank update:', error);
    throw error;
  }
};

/** Fetch daily points row for a user and date (null if none). */
export const getDailyPoints = async (userId, date) => {
  const targetDate = date || new Date().toISOString().split('T')[0];

  const { data: dailyPoints, error } = await supabaseAdmin
    .from('daily_points')
    .select('*')
    .eq('user_id', userId)
    .eq('date', targetDate)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return dailyPoints || null;
}; 