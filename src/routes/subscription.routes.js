import { Router } from 'express';
import {
  createSubscriptionCheckout,
  createCustomerPortalSession,
  getSubscriptionStatus,
  cancelSubscription,
  reactivateSubscription,
} from '../services/subscriptionService.js';
import { requireSubscription } from '../middleware/subscription.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.post('/subscription/checkout', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    
    const session = await createSubscriptionCheckout(
      req.user.id, 
      req.user.email, 
      name || req.user.user_metadata?.full_name
    );
    
    res.json({ session });
  } catch (error) {
    console.error('Error creating subscription checkout:', error);
    res.status(500).json({ error: error.message || 'Failed to create subscription checkout' });
  }
});

router.post('/subscription/portal', authenticateToken, async (req, res) => {
  try {
    const session = await createCustomerPortalSession(req.user.id);
    res.json({ session });
  } catch (error) {
    console.error('Error creating customer portal session:', error);
    res.status(500).json({ error: error.message || 'Failed to create customer portal session' });
  }
});

router.get('/subscription/status', authenticateToken, async (req, res) => {
  try {
    const subscription = await getSubscriptionStatus(req.user.id);
    res.json(subscription);
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch subscription status' });
  }
});

router.post('/subscription/cancel', authenticateToken, async (req, res) => {
  try {
    const subscription = await cancelSubscription(req.user.id);
    res.json({ success: true, subscription });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel subscription' });
  }
});

router.post('/subscription/reactivate', authenticateToken, async (req, res) => {
  try {
    const subscription = await reactivateSubscription(req.user.id);
    res.json({ success: true, subscription });
  } catch (error) {
    console.error('Error reactivating subscription:', error);
    res.status(500).json({ error: error.message || 'Failed to reactivate subscription' });
  }
});

// Stripe redirect pages - simple HTML pages the WebView detects via URL params
router.get('/subscription/success', (req, res) => {
  const sessionId = req.query.session_id || '';
  res.send(`<!DOCTYPE html><html><head><title>Payment Successful</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
    <div style="text-align:center"><h1>Payment Successful!</h1><p>Your subscription is now active.</p></div>
  </body></html>`);
});

router.get('/subscription/cancel', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Payment Canceled</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
    <div style="text-align:center"><h1>Payment Canceled</h1><p>You can try again anytime.</p></div>
  </body></html>`);
});

router.get('/subscription/portal-return', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Subscription Updated</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
    <div style="text-align:center"><h1>Subscription Updated</h1><p>You can close this window and return to the app.</p></div>
  </body></html>`);
});

// Premium features endpoints (require subscription)
router.get('/premium/features', authenticateToken, requireSubscription, async (req, res) => {
  try {
    // Example premium features
    const features = [
      'Advanced analytics',
      'Personalized recommendations',
      'Priority support',
      'Exclusive content'
    ];
    
    res.json({ 
      features,
      subscription: req.subscription 
    });
  } catch (error) {
    console.error('Error fetching premium features:', error);
    res.status(500).json({ error: 'Failed to fetch premium features' });
  }
});

router.post('/progress/populate-from-missions', authenticateToken, async (req, res) => {
  try {
    console.log('🔄 Progress population request received for user:', req.user.id);
    
    const result = await populateProgressFromMissions(req.user.id);
    
    if (result.success) {
      console.log('✅ Progress population successful:', result.message);
      res.json(result);
    } else {
      console.log('⚠️  Progress population failed:', result.message);
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('❌ Error in progress population endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to populate progress from missions' 
    });
  }
});

export default router;
