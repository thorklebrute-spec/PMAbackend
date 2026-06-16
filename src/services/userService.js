import { supabaseAdmin } from '../config/supabase.js';
import { populateProgressFromMissions } from './progress.js';

export const saveOnboarding = async (userId, onboardingData) => {
  if (!onboardingData) {
    throw new Error('Onboarding data is required');
  }

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .upsert([
      {
        id: userId,
        onboarding_data: onboardingData,
        updated_at: new Date().toISOString(),
      },
    ], {
      onConflict: 'id',
    })
    .select();

  if (error) {
    console.error('Error storing onboarding data:', error);
    throw new Error('Failed to store onboarding data');
  }

  try {
    console.log('🔄 Auto-populating progress after onboarding completion...');
    const populateResult = await populateProgressFromMissions(userId);

    if (populateResult.success) {
      console.log('✅ Auto-progress population successful:', populateResult.message);
    } else {
      console.log('ℹ️  Auto-progress population skipped:', populateResult.message);
    }
  } catch (populateError) {
    console.error('⚠️  Auto-progress population failed:', populateError);
  }

  return { success: true, data: data[0] };
};

export const getOnboarding = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('onboarding_data')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching onboarding data:', error);
    throw new Error('Failed to fetch onboarding data');
  }

  return { data: data?.onboarding_data || null };
};

export const getOnboardingStatus = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('onboarding_data')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching onboarding status:', error);
    throw new Error('Failed to fetch onboarding status');
  }

  const onboardingData = data?.onboarding_data || null;
  const hasOnboardingData = Boolean(
    onboardingData &&
    typeof onboardingData === 'object' &&
    Object.keys(onboardingData).length > 0
  );

  return {
    hasOnboardingData,
    onboardingData: hasOnboardingData ? onboardingData : null,
  };
};

export const getUnitsPreference = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('units_preference')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching user preferences:', error);
    throw new Error('Failed to fetch user preferences');
  }

  const unitsPreference = data?.units_preference === 'imperial' ? 'imperial' : 'metric';
  return { unitsPreference };
};

export const updateUnitsPreference = async (userId, unitsPreference) => {
  if (unitsPreference !== 'metric' && unitsPreference !== 'imperial') {
    throw new Error('Invalid unitsPreference. Allowed: metric|imperial');
  }

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .upsert([
      {
        id: userId,
        units_preference: unitsPreference,
        updated_at: new Date().toISOString(),
      },
    ], {
      onConflict: 'id',
    })
    .select();

  if (error) {
    console.error('Error updating user preferences:', error);
    throw new Error('Failed to update user preferences');
  }

  return { success: true, unitsPreference, data: data[0] };
};
