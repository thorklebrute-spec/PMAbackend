import { getSubscriptionStatus } from './subscriptionService.js';

// Middleware to check if user has active subscription
export const requireSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const subscription = await getSubscriptionStatus(userId);
    
    // Stripe-only access model: only active/trialing can pass
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
    
    // Add subscription info to request
    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('Subscription middleware error:', error);
    res.status(500).json({ error: 'Failed to check subscription status' });
  }
};

// Middleware to check subscription status but allow access (for informational purposes)
export const checkSubscription = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const subscription = await getSubscriptionStatus(userId);
    
    // Add subscription info to request
    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('Subscription check middleware error:', error);
    // Don't block access, just set subscription to null
    req.subscription = { status: 'error', subscription: null };
    next();
  }
};

// Helper function to check if user is in trial period
export const isInTrialPeriod = (subscription) => {
  if (!subscription.subscription) return false;
  
  const now = Math.floor(Date.now() / 1000);
  return subscription.subscription.trial_end && subscription.subscription.trial_end > now;
};

// Helper function to get days remaining in trial
export const getTrialDaysRemaining = (subscription) => {
  if (!subscription.subscription || !subscription.subscription.trial_end) return 0;
  
  const now = Math.floor(Date.now() / 1000);
  const daysRemaining = Math.ceil((subscription.subscription.trial_end - now) / (24 * 60 * 60));
  
  return Math.max(0, daysRemaining);
};

// Helper function to check if subscription is active
export const isSubscriptionActive = (subscription) => {
  return subscription.status === 'active' || subscription.status === 'trialing';
}; 