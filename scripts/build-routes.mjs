import fs from 'fs';
import path from 'path';

const server = fs.readFileSync('server.js', 'utf8');
const routesDir = 'src/routes';

function between(start, end) {
  const s = server.indexOf(start);
  if (s === -1) throw new Error(`Start not found: ${start}`);
  const e = end ? server.indexOf(end, s) : server.length;
  if (e === -1) throw new Error(`End not found: ${end}`);
  return server.slice(s, e);
}

function toRouter(code) {
  return code
    .replace(/^\/\/ ───[^\n]*\n/gm, '')
    .replace(/\bapp\.(get|post|put|patch|delete)\(/g, 'router.$1(')
    .trim();
}

function writeRoute(filename, imports, body) {
  const content = `import { Router } from 'express';
${imports}
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

${toRouter(body)}

export default router;
`;
  fs.writeFileSync(path.join(routesDir, filename), content);
  console.log('wrote', filename);
}

writeRoute(
  'health.routes.js',
  '',
  between("app.get('/',", "// ─── Auth")
);

writeRoute(
  'auth.routes.js',
  `import { supabase, signUpWithEmail, signInWithEmail, signInWithGoogle, signOut } from '../config/supabase.js';
import { getAuthUserPayload } from '../services/authService.js';`,
  between("app.post('/auth/signup'", "// ─── AI / Migration") + '\n' +
  between("app.post('/auth/forgot-password'", "// ─── User") + '\n' +
  between("app.post('/auth/signout'", "// ─── Lifestyle")
);

writeRoute(
  'ai.routes.js',
  `import { generateOrGetWeeklyCoachReport } from '../services/aiCoachService.js';`,
  between("app.post('/ai/coach/weekly-report'", "app.post('/user/migrate-guest-data'")
);

writeRoute(
  'user.routes.js',
  `import { migrateGuestDataToUser } from '../services/guestMigrationService.js';
import { saveOnboarding, getOnboarding, getOnboardingStatus, getUnitsPreference, updateUnitsPreference } from '../services/userService.js';`,
  between("app.post('/user/migrate-guest-data'", "app.post('/auth/forgot-password'") + '\n' +
  between("app.get('/user/onboarding-status'", "app.post('/auth/signout'") + '\n' +
  between("app.post('/user/onboarding'", "// ─── Subscription")
);

writeRoute(
  'lifestyle.routes.js',
  `import { calculateAndSaveLifestyleScore, getLatestLifestyleScore } from '../services/lifestyleService.js';`,
  between("// ─── Lifestyle", "// ─── Missions")
);

writeRoute(
  'missions.routes.js',
  `import { getDailyMissions, getDailyMissionStats, getTodayDailyMissions, checkMissionsCompleted } from '../services/dailyMissions.js';
import { checkAndSaveDailyProgress } from '../services/progress.js';
import { validateMissionUncheck, saveDailyMissionsWithSideEffects } from '../services/missionWorkflow.js';`,
  between("// ─── Missions", "// ─── Progress")
);

writeRoute(
  'progress.routes.js',
  `import { getUserProgress, saveUserProgress, getProgressStats, getTodayProgress, populateProgressFromMissions, enrichHealthDataForUnits } from '../services/progress.js';`,
  between("// ─── Progress", "app.post('/user/onboarding'") + '\n' +
  between("app.post('/progress/populate-from-missions'", "// ─── Rank")
);

writeRoute(
  'subscription.routes.js',
  `import express from 'express';
import {
  createSubscriptionCheckout,
  createCustomerPortalSession,
  getSubscriptionStatus,
  cancelSubscription,
  reactivateSubscription,
  handleWebhookEvent
} from '../services/subscriptionService.js';
import { requireSubscription } from '../middleware/subscription.js';
import { stripe } from '../config/stripe.js';`,
  between("// ─── Subscription", "// ─── Rank")
);

writeRoute(
  'rank.routes.js',
  `import { getUserRank, getLeaderboard, getDailyPoints } from '../services/rankSystem.js';`,
  between("// ─── Rank", "// ─── Profile")
);

writeRoute(
  'profile.routes.js',
  `import {
  getUserProfile,
  updateUserProfile,
  uploadProfilePicture,
  deleteProfilePicture,
} from '../services/profileService.js';`,
  between("// ─── Profile", "app.use((err, req, res, next)")
);
