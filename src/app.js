import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mountRoutes from './routes/index.js';

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

app.use(express.json());
app.use('/policy', express.static(policyDir, { index: 'index.html' }));

/*
 * Route index
 * ─────────────────────────────────────────────────────────
 * GET  /, /health                 Service + health check
 * GET  /policy/                   Legal policy hub
 * GET  /policy/privacy-policy.html Play Store privacy policy
 * GET  /policy/terms-and-conditions.html Terms of use
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
 * POST /subscription/*            Stripe checkout / portal / status
 * POST /webhook/stripe            Stripe webhooks
 * GET  /rank*                     Rank, leaderboard, daily points
 * GET|PUT|POST|DELETE /profile*   Profile + picture
 */

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
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
