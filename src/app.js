import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mountRoutes from './routes/index.js';
import { stripe } from './config/stripe.js';
import { handleWebhookEvent } from './services/subscriptionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policyDir = path.join(__dirname, '..', 'public', 'policy');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Authorization'],
  credentials: true
}));

app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      await handleWebhookEvent(event);
      res.json({ received: true });
    } catch (error) {
      console.error('Error handling webhook event:', error);
      res.status(500).json({ error: 'Webhook handler failed' });
    }
  }
);

app.post(
  '/webhook/apple',
  express.json({ type: '*/*' }),
  async (req, res) => {
    try {
      const signedPayload = req.body?.signedPayload || req.body?.signed_payload;
      if (!signedPayload) {
        return res.status(400).json({ error: 'signedPayload is required' });
      }

      const { handleAppleServerNotification } = await import(
        './services/appleSubscriptionService.js'
      );
      const result = await handleAppleServerNotification(signedPayload);
      res.json({ received: true, ...result });
    } catch (error) {
      console.error('Error handling Apple webhook:', error);
      res.status(400).json({ error: error.message || 'Apple webhook handler failed' });
    }
  }
);

app.use(express.json());
app.use('/policy', express.static(policyDir, { index: 'index.html' }));

/*
 * Route index
 * ─────────────────────────────────────────────────────────
 * GET  /, /health                 Service + health check
 * GET  /policy/                   Legal policy hub
 * GET  /policy/privacy-policy.html Play Store privacy policy
 * GET  /policy/terms-and-conditions.html Terms of use
 * GET  /policy/delete-account.html Account deletion instructions (Play Store)
 * POST /auth/*                    Signup, signin, OAuth, session
 * GET  /auth/user                 Current user + access + onboarding flags
 * POST /ai/coach/weekly-report    AI coach report
 * POST /user/migrate-guest-data   Guest → user migration
 * POST /user/onboarding           Save onboarding
 * GET  /user/onboarding           Get onboarding
 * GET  /user/onboarding-status    Onboarding completion check
 * GET|PATCH /user/preferences     Units preference
 * POST /lifestyle/score           Calculate + save lifestyle score
 * GET  /lifestyle/score           Latest lifestyle score
 * GET|POST /daily-missions*       Mission CRUD + stats
 * GET|POST /progress*             Progress tracking
 * POST /subscription/*            Stripe + Apple verify / portal / status
 * POST /webhook/stripe            Stripe webhooks
 * POST /webhook/apple             App Store Server Notifications V2
 * GET  /rank*                     Rank, leaderboard, daily points
 * GET|PUT|POST|DELETE /profile*   Profile + picture
 */

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.path !== '/webhook/stripe' && req.path !== '/webhook/apple' && req.body && Object.keys(req.body).length > 0) {
    console.log('Request body:', {
      ...req.body,
      password: req.body.password ? '[REDACTED]' : undefined
    });
  }
  next();
});

mountRoutes(app);

app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

export default app;
