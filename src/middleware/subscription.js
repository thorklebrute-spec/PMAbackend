import { getSubscriptionStatus } from '../services/subscriptionService.js';

export const requireSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const subscription = await getSubscriptionStatus(userId);

    const hasAccess =
      subscription.status === 'active' ||
      subscription.status === 'trialing';

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Subscription required',
        message: 'This feature requires an active subscription',
        subscription: subscription
      });
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('Subscription middleware error:', error);
    res.status(500).json({ error: 'Failed to check subscription status' });
  }
};

export const checkSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const subscription = await getSubscriptionStatus(userId);

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('Subscription check middleware error:', error);
    req.subscription = { status: 'error', subscription: null };
    next();
  }
};

export const isInTrialPeriod = (subscription) => {
  if (!subscription.subscription) return false;

  const now = Math.floor(Date.now() / 1000);
  return subscription.subscription.trial_end && subscription.subscription.trial_end > now;
};

export const getTrialDaysRemaining = (subscription) => {
  if (!subscription.subscription || !subscription.subscription.trial_end) return 0;

  const now = Math.floor(Date.now() / 1000);
  const daysRemaining = Math.ceil((subscription.subscription.trial_end - now) / (24 * 60 * 60));

  return Math.max(0, daysRemaining);
};

export const isSubscriptionActive = (subscription) => {
  return subscription.status === 'active' || subscription.status === 'trialing';
};
