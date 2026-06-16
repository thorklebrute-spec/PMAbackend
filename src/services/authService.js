import { supabaseAdmin } from '../config/supabase.js';
import { getSubscriptionStatus } from './subscriptionService.js';

/**
 * Build the GET /auth/user payload: user profile, subscription access, onboarding flags.
 */
export const getAuthUserPayload = async (userId) => {
  const { data: { user: fullUser }, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userError) throw userError;

  const user = fullUser;
  const userData = {
    id: user.id,
    email: user.email,
    user_metadata: user.user_metadata || {},
    app_metadata: user.app_metadata || {},
    created_at: user.created_at,
    updated_at: user.updated_at,
  };

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('subscription_status, onboarding_data')
    .eq('id', user.id)
    .single();

  if (profileError && profileError.code !== 'PGRST116') {
    throw profileError;
  }

  let liveSubscription = null;
  try {
    liveSubscription = await getSubscriptionStatus(user.id);
  } catch (subscriptionError) {
    console.warn('Falling back to DB subscription status:', subscriptionError.message);
  }

  const subscriptionStatus = liveSubscription?.status || profile?.subscription_status || 'no_subscription';
  const stripeTrialEndSec = liveSubscription?.subscription?.trial_end || null;
  const stripeTrialEndsAt = stripeTrialEndSec ? new Date(stripeTrialEndSec * 1000) : null;
  const now = new Date();
  const subscriptionActive = ['active', 'trialing'].includes(subscriptionStatus);
  const hasAccess = subscriptionActive;
  const trialActive = subscriptionStatus === 'trialing';
  const reason = subscriptionActive
    ? (subscriptionStatus === 'trialing' ? 'trial_active' : 'subscription_active')
    : 'no_access';
  const trialDaysRemaining = subscriptionStatus === 'trialing' && stripeTrialEndsAt && stripeTrialEndsAt > now
    ? Math.ceil((stripeTrialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const access = {
    hasAccess,
    reason,
    subscriptionStatus,
    trialActive,
    trialDaysRemaining,
    trialEndsAt: stripeTrialEndsAt ? stripeTrialEndsAt.toISOString() : null,
  };

  const hasOnboardingData = Boolean(
    profile?.onboarding_data &&
    typeof profile.onboarding_data === 'object' &&
    Object.keys(profile.onboarding_data).length > 0
  );

  console.log('User data retrieved:', {
    ...userData,
    user_metadata: userData.user_metadata ? 'present' : 'missing',
    access,
    hasOnboardingData,
  });

  return {
    user: userData,
    access,
    onboarding: {
      hasOnboardingData,
    },
  };
};
