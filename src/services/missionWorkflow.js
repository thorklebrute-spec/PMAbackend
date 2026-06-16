import { supabaseAdmin } from '../config/supabase.js';
import { MISSION_FIELDS } from '../constants/missions.js';
import { saveDailyMissions, getTodayDailyMissions } from './dailyMissions.js';
import { checkAndSaveDailyProgress } from './progress.js';
import { processDailyRankUpdate } from './rankSystem.js';

/**
 * Returns true if the incoming payload tries to uncheck a completed mission.
 */
export const validateMissionUncheck = (existingMissions, incomingMissions) => {
  if (!existingMissions) return false;

  return MISSION_FIELDS.some(
    (field) => existingMissions[field] === true && incomingMissions[field] === false
  );
};

/**
 * Save missions and run progress + rank side effects (same behavior as POST /daily-missions).
 */
export const saveDailyMissionsWithSideEffects = async (userId, date, missions) => {
  const result = await saveDailyMissions(userId, date, missions);

  try {
    console.log('🔍 Checking if progress should be saved...');
    console.log('User ID:', userId);
    console.log('Date:', date);
    console.log('Missions:', missions);

    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('onboarding_data')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.log('❌ Error fetching onboarding data:', profileError);
    } else if (!profileData?.onboarding_data) {
      console.log('⚠️  No onboarding data found for user, skipping progress save');
    } else {
      console.log('✅ Onboarding data found, checking if all missions completed...');
      const onboardingData = profileData.onboarding_data;

      const progressResult = await checkAndSaveDailyProgress(userId, date, missions, onboardingData);

      if (progressResult.success) {
        console.log('✅ Daily progress automatically saved:', progressResult.metrics);
      } else {
        console.log('ℹ️  Progress not saved:', progressResult.message);
      }
    }
  } catch (progressError) {
    console.error('❌ Error checking daily progress:', progressError);
    console.error('Error details:', {
      message: progressError.message,
      stack: progressError.stack,
    });
  }

  try {
    console.log('🏆 Processing rank update for daily missions...');
    const { data: lifestyleData } = await supabaseAdmin
      .from('lifestyle_scores')
      .select('overall_score')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const lifestyleScore = lifestyleData?.overall_score || null;
    const rankUpdate = await processDailyRankUpdate(userId, date, missions, lifestyleScore);

    console.log('✅ Rank update completed:', {
      pointsEarned: rankUpdate.pointsEarned,
      newRank: rankUpdate.rankInfo.name,
      totalPoints: rankUpdate.newTotalPoints,
    });

    result.rankUpdate = {
      pointsEarned: rankUpdate.pointsEarned,
      newRank: rankUpdate.rankInfo.name,
      totalPoints: rankUpdate.newTotalPoints,
      pointsToNextRank: rankUpdate.rank.points_to_next_rank,
    };
  } catch (rankError) {
    console.error('⚠️  Rank update failed:', rankError);
  }

  return result;
};
