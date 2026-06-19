import { supabaseAdmin } from '../config/supabase.js';
import { calculateLifestyleScore } from './lifestyleScore.js';

const REQUIRED_ONBOARDING_FIELDS = [
  'goal', 'diet', 'hadTest', 'age', 'spermCount', 'exerciseDays',
  'smoke', 'alcohol', 'sleep', 'stress', 'sunlightExposure', 'supplements', 'dataLog',
];

const validateOnboardingFields = (onboardingData) => {
  for (const field of REQUIRED_ONBOARDING_FIELDS) {
    if (onboardingData[field] === undefined) {
      throw new Error(`Missing field: ${field}`);
    }
  }
};

/**
 * Calculate lifestyle score, persist to lifestyle_scores, return score payload.
 */
export const calculateAndSaveLifestyleScore = async (userId, bodyOnboardingData) => {
  let onboardingData = bodyOnboardingData;

  if (!onboardingData || Object.keys(onboardingData).length === 0) {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('onboarding_data')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.onboarding_data) {
      throw new Error('Onboarding data is required');
    }
    onboardingData = profile.onboarding_data;
  }

  validateOnboardingFields(onboardingData);

  console.log('\n=== LIFESTYLE SCORE CALCULATION ===');
  console.log('User ID:', userId);
  console.log('\nOnboarding Data:');
  console.log(JSON.stringify(onboardingData, null, 2));

  let scoreData;
  try {
    scoreData = calculateLifestyleScore(onboardingData);
  } catch (err) {
    console.error('Error in calculateLifestyleScore:', err, onboardingData);
    const calcError = new Error('Failed to calculate lifestyle score');
    calcError.code = 'CALCULATE_FAILED';
    calcError.details = err.message;
    throw calcError;
  }

  console.log('\nCalculated Scores:');
  console.log('Overall Score:', scoreData.overallScore);
  console.log('Yearly Decline Rate:', scoreData.yearlyDeclineRate + '%');
  console.log('Impact Multiplier:', scoreData.impactMultiplier);

  console.log('\nFactor Scores:');
  Object.entries(scoreData.factorScores).forEach(([factor, score]) => {
    console.log(`${factor}: ${score}`);
  });

  console.log('\nFactor Descriptions:');
  Object.entries(scoreData.factorDescriptions).forEach(([factor, description]) => {
    console.log(`${factor}: ${description}`);
  });

  console.log('\nRecommendations:');
  scoreData.recommendations.forEach((rec, index) => {
    console.log(`${index + 1}. ${rec}`);
  });

  console.log('\n=== END LIFESTYLE SCORE ===\n');

  const { error } = await supabaseAdmin
    .from('lifestyle_scores')
    .insert([
      {
        user_id: userId,
        overall_score: scoreData.overallScore,
        yearly_decline_rate: scoreData.yearlyDeclineRate,
        impact_multiplier: scoreData.impactMultiplier,
        factor_scores: scoreData.factorScores,
        factor_descriptions: scoreData.factorDescriptions,
        recommendations: scoreData.recommendations,
        created_at: new Date().toISOString(),
      },
    ])
    .select();

  if (error) {
    console.error('Error storing lifestyle score:', error);
  }

  return scoreData;
};

/** Returns latest lifestyle_scores row or null if none. */
export const getLatestLifestyleScore = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('lifestyle_scores')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error fetching lifestyle score:', error);
    throw new Error('Failed to fetch lifestyle score');
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0];
};
