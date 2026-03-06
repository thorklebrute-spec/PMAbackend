import { stripe, SUBSCRIPTION_CONFIG, getBaseUrl } from './stripeConfig.js';
import { supabaseAdmin } from './supabaseClient.js';

const hasPriorStripeSubscription = async (customerId) => {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 1,
  });

  return subscriptions.data.length > 0;
};

// Create a Stripe customer
export const createStripeCustomer = async (userId, email, name = null) => {
  try {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: {
        userId: userId,
      },
    });

    // Store customer ID in user_profiles table
    await supabaseAdmin
      .from('user_profiles')
      .update({ 
        stripe_customer_id: customer.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    return customer;
  } catch (error) {
    console.error('Error creating Stripe customer:', error);
    throw error;
  }
};

// Get or create Stripe customer
export const getOrCreateStripeCustomer = async (userId, email, name = null) => {
  try {
    // Check if user already has a Stripe customer ID
    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (profile?.stripe_customer_id) {
      // Return existing customer
      return await stripe.customers.retrieve(profile.stripe_customer_id);
    }

    // Create new customer
    return await createStripeCustomer(userId, email, name);
  } catch (error) {
    console.error('Error getting or creating Stripe customer:', error);
    throw error;
  }
};

// Create checkout session for subscription
export const createSubscriptionCheckout = async (userId, email, name = null) => {
  try {
    const customer = await getOrCreateStripeCustomer(userId, email, name);
    const hasUsedStripeBefore = await hasPriorStripeSubscription(customer.id);
    const eligibleForTrial = !hasUsedStripeBefore;

    const subscriptionData = {
      metadata: {
        userId: userId,
      },
    };

    if (eligibleForTrial) {
      subscriptionData.trial_period_days = Number(SUBSCRIPTION_CONFIG.TRIAL_DAYS) || 0;
    } else {
      // Do not inherit a trial from the Stripe Price for ineligible users.
      subscriptionData.trial_from_plan = false;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      line_items: [
        {
          price: SUBSCRIPTION_CONFIG.MONTHLY_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      subscription_data: subscriptionData,
      success_url: `${SUBSCRIPTION_CONFIG.SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: SUBSCRIPTION_CONFIG.CANCEL_URL,
      metadata: {
        userId: userId,
      },
    });

    return session;
  } catch (error) {
    console.error('Error creating subscription checkout:', error);
    throw error;
  }
};

// Create customer portal session
export const createCustomerPortalSession = async (userId) => {
  try {
    // Get user's Stripe customer ID
    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error || !profile?.stripe_customer_id) {
      throw new Error('No Stripe customer found for user');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${getBaseUrl()}/subscription/portal-return`,
    });

    return session;
  } catch (error) {
    console.error('Error creating customer portal session:', error);
    throw error;
  }
};

// Get subscription status
export const getSubscriptionStatus = async (userId) => {
  try {
    // Get user's Stripe customer ID
    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id, subscription_status, subscription_id')
      .eq('id', userId)
      .single();

    if (error) {
      throw error;
    }

    if (!profile?.stripe_customer_id) {
      return { status: 'no_subscription', subscription: null };
    }

    // Get subscriptions from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'all',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return { status: 'no_subscription', subscription: null };
    }

    const subscription = subscriptions.data[0];
    
    // Update local subscription status
    await supabaseAdmin
      .from('user_profiles')
      .update({
        subscription_status: subscription.status,
        subscription_id: subscription.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    return {
      status: subscription.status,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        trial_start: subscription.trial_start,
        trial_end: subscription.trial_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
      },
    };
  } catch (error) {
    console.error('Error getting subscription status:', error);
    throw error;
  }
};

// Cancel subscription
export const cancelSubscription = async (userId) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('subscription_id')
      .eq('id', userId)
      .single();

    if (error || !profile?.subscription_id) {
      throw new Error('No active subscription found');
    }

    const subscription = await stripe.subscriptions.update(profile.subscription_id, {
      cancel_at_period_end: true,
    });

    // Update local status
    await supabaseAdmin
      .from('user_profiles')
      .update({
        subscription_status: subscription.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    return subscription;
  } catch (error) {
    console.error('Error canceling subscription:', error);
    throw error;
  }
};

// Reactivate subscription
export const reactivateSubscription = async (userId) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('subscription_id')
      .eq('id', userId)
      .single();

    if (error || !profile?.subscription_id) {
      throw new Error('No subscription found');
    }

    const subscription = await stripe.subscriptions.update(profile.subscription_id, {
      cancel_at_period_end: false,
    });

    // Update local status
    await supabaseAdmin
      .from('user_profiles')
      .update({
        subscription_status: subscription.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    return subscription;
  } catch (error) {
    console.error('Error reactivating subscription:', error);
    throw error;
  }
};

// Handle webhook events
export const handleWebhookEvent = async (event) => {
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionChange(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error('Error handling webhook event:', error);
    throw error;
  }
};

// Handle subscription changes
const handleSubscriptionChange = async (subscription) => {
  try {
    const userId = subscription.metadata?.userId;
    if (!userId) {
      console.error('No userId in subscription metadata');
      return;
    }

    await supabaseAdmin
      .from('user_profiles')
      .update({
        subscription_status: subscription.status,
        subscription_id: subscription.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    console.log(`Subscription ${subscription.status} for user ${userId}`);
  } catch (error) {
    console.error('Error handling subscription change:', error);
    throw error;
  }
};

// Handle successful payment
const handlePaymentSucceeded = async (invoice) => {
  try {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const userId = subscription.metadata?.userId;
    
    if (userId) {
      await supabaseAdmin
        .from('user_profiles')
        .update({
          subscription_status: subscription.status,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
    }
  } catch (error) {
    console.error('Error handling payment succeeded:', error);
    throw error;
  }
};

// Handle failed payment
const handlePaymentFailed = async (invoice) => {
  try {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const userId = subscription.metadata?.userId;
    
    if (userId) {
      await supabaseAdmin
        .from('user_profiles')
        .update({
          subscription_status: subscription.status,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
    }
  } catch (error) {
    console.error('Error handling payment failed:', error);
    throw error;
  }
}; 