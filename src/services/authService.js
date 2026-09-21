import { supabaseAdmin } from '../config/supabase.js';
import { getSubscriptionStatus, hasPriorStripeSubscription } from './subscriptionService.js';

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
    .select(
      'subscription_status, onboarding_data, guest_trial_started_at, stripe_customer_id, billing_provider, apple_expires_at'
    )
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
  const billingProvider = liveSubscription?.provider || profile?.billing_provider || null;
  const stripeTrialEndSec = liveSubscription?.subscription?.trial_end || null;
  const stripeTrialEndsAt = stripeTrialEndSec ? new Date(stripeTrialEndSec * 1000) : null;
  const appleExpiresAt = liveSubscription?.subscription?.expiresAt
    ? new Date(liveSubscription.subscription.expiresAt)
    : (profile?.apple_expires_at ? new Date(profile.apple_expires_at) : null);
  const now = new Date();
  const subscriptionActive = ['active', 'trialing'].includes(subscriptionStatus);
  const hasAccess = subscriptionActive;
  const trialActive = subscriptionStatus === 'trialing';
  const guestTrialUsed = Boolean(profile?.guest_trial_started_at);
  let stripeTrialEligible = !guestTrialUsed;
  if (stripeTrialEligible && profile?.stripe_customer_id) {
    try {
      stripeTrialEligible = !(await hasPriorStripeSubscription(profile.stripe_customer_id));
    } catch (priorSubError) {
      console.warn('Could not check prior Stripe subscription:', priorSubError.message);
    }
  }
  const reason = subscriptionActive
    ? (subscriptionStatus === 'trialing' ? 'trial_active' : 'subscription_active')
    : guestTrialUsed
      ? 'guest_trial_consumed'
      : 'no_access';

  let trialDaysRemaining = 0;
  let trialEndsAt = null;
  if (subscriptionStatus === 'trialing') {
    if (billingProvider === 'apple' && appleExpiresAt && appleExpiresAt > now) {
      trialEndsAt = appleExpiresAt.toISOString();
      trialDaysRemaining = Math.ceil((appleExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    } else if (stripeTrialEndsAt && stripeTrialEndsAt > now) {
      trialEndsAt = stripeTrialEndsAt.toISOString();
      trialDaysRemaining = Math.ceil((stripeTrialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  const access = {
    hasAccess,
    reason,
    subscriptionStatus,
    billingProvider,
    trialActive,
    trialDaysRemaining,
    trialEndsAt,
    guestTrialUsed,
    stripeTrialEligible,
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
