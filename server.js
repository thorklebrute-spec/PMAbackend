import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { supabase, supabaseAdmin, signUpWithEmail, signInWithEmail, signInWithGoogle, signOut } from './supabaseClient.js';
import { calculateLifestyleScore } from './lifestyleScore.js';
import { getDailyMissions, saveDailyMissions, getDailyMissionStats, getTodayDailyMissions, checkMissionsCompleted } from './dailyMissions.js';
import { getUserProgress, saveUserProgress, getProgressStats, getTodayProgress, checkAndSaveDailyProgress, populateProgressFromMissions, enrichHealthDataForUnits } from './progress.js';
import { 
  createSubscriptionCheckout, 
  createCustomerPortalSession, 
  getSubscriptionStatus, 
  cancelSubscription, 
  reactivateSubscription,
  handleWebhookEvent 
} from './subscriptionService.js';
import { requireSubscription, checkSubscription } from './subscriptionMiddleware.js';
import { stripe } from './stripeConfig.js';
import { processDailyRankUpdate, getUserRank, getLeaderboard } from './rankSystem.js';
import { 
  getUserProfile, 
  updateUserProfile, 
  uploadProfilePicture, 
  deleteProfilePicture,
  getProfilePictureUrl 
} from './profileService.js';

const app = express();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Authorization'],
  credentials: true
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Primal Male API' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

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

app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      console.log('Signup failed: Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('Signup failed: Invalid email format');
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      console.log('Signup failed: Password too short');
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    console.log('Attempting signup for:', email);
    const result = await signUpWithEmail(email, password);
    
    if (!result.user) {
      console.log('Signup failed: No user data returned');
      return res.status(400).json({ error: 'Failed to create user' });
    }

    console.log('Signup successful:', {
      user: result.user,
      session: result.session ? {
        access_token: result.session.access_token ? 'present' : 'missing',
        refresh_token: result.session.refresh_token ? 'present' : 'missing',
        expires_at: result.session.expires_at
      } : null
    });
    
    res.json(result);
  } catch (error) {
    console.error('Signup error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      stack: error.stack
    });

    if (error.message?.includes('already registered')) {
      return res.status(400).json({ error: 'Email already registered. Please sign in instead.' });
    }
    
    res.status(400).json({ error: error.message || 'Signup failed' });
  }
});

app.post('/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      console.log('Signin failed: Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('Signin failed: Invalid email format');
      return res.status(400).json({ error: 'Invalid email format' });
    }

    console.log('Attempting signin for:', email);
    const result = await signInWithEmail(email, password);
    
    if (!result.user) {
      console.log('Signin failed: No user data returned');
      return res.status(400).json({ error: 'Failed to sign in' });
    }

    console.log('User signed in successfully:', {
      id: result.user.id,
      email: result.user.email,
      user_metadata: result.user.user_metadata,
      app_metadata: result.user.app_metadata,
      created_at: result.user.created_at,
      updated_at: result.user.updated_at,
      last_sign_in_at: result.user.last_sign_in_at,
      role: result.user.role,
      identities: result.user.identities
    });

    console.log('Signin successful:', {
      user: result.user,
      session: result.session ? {
        access_token: result.session.access_token ? 'present' : 'missing',
        refresh_token: result.session.refresh_token ? 'present' : 'missing',
        expires_at: result.session.expires_at
      } : null
    });
    
    res.json(result);
  } catch (error) {
    console.error('Signin error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      stack: error.stack
    });

    if (error.message?.includes('Invalid login credentials')) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    res.status(400).json({ error: error.message || 'Signin failed' });
  }
});

app.post('/auth/resend-confirmation', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    console.log('Resending confirmation email to:', email);
    const { error } = await supabase.auth.resend({ type: 'signup', email });

    if (error) {
      console.error('Resend confirmation error:', error.message);
      return res.status(400).json({ error: error.message || 'Failed to resend confirmation email' });
    }

    console.log('Confirmation email resent to:', email);
    res.json({ message: 'Confirmation email sent' });
  } catch (error) {
    console.error('Resend confirmation unexpected error:', error);
    res.status(500).json({ error: 'Failed to resend confirmation email' });
  }
});

app.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    console.log('Sending password reset email to:', email);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'primalmale://reset-password',
    });

    if (error) {
      console.error('Forgot password error:', error.message);
    }

    // Always return success to avoid revealing whether an account exists
    console.log('Password reset email request processed for:', email);
    res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password unexpected error:', error);
    res.status(500).json({ error: 'Failed to send password reset email' });
  }
});

app.post('/auth/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      console.log('Refresh failed: No refresh token provided');
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    console.log('Attempting to refresh session with token:', refresh_token);
    
    const { data: { session }, error } = await supabase.auth.refreshSession({
      refresh_token: refresh_token
    });

    if (error) {
      console.error('Session refresh error:', error);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    if (!session) {
      console.error('No session returned from refresh');
      return res.status(401).json({ error: 'Failed to refresh session' });
    }

    console.log('Session refreshed successfully');
    res.json({ session });
  } catch (error) {
    console.error('Session refresh error:', {
      message: error.message,
      code: error.code,
      details: error.details
    });
    res.status(400).json({ error: error.message || 'Failed to refresh session' });
  }
});

app.get('/auth/email-confirmed', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Email Confirmed</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
    <div style="text-align:center"><h1>Email Confirmed!</h1><p>You can now open the app and sign in.</p></div>
  </body></html>`);
});

// Mobile OAuth callback - serves an HTML page that reads tokens from the
// URL fragment and redirects to the Expo app via deep link
app.get('/auth/mobile-callback', (req, res) => {
  const appRedirect = req.query.appRedirect || 'exp://';
  res.send(`<!DOCTYPE html><html><head><title>Signing in...</title></head><body>
    <p>Completing sign in...</p>
    <script>
      const hash = window.location.hash.substring(1);
      if (hash) {
        window.location.href = decodeURIComponent("${encodeURIComponent(appRedirect)}") + "#" + hash;
      } else {
        document.body.innerHTML = "<p>Authentication failed. Please close this and try again.</p>";
      }
    </script>
  </body></html>`);
});

app.post('/auth/google', async (req, res) => {
  try {
    const { redirectUrl } = req.body || {};
    console.log('Attempting Google signin, redirectUrl:', redirectUrl);

    // Build a backend callback URL that will redirect to the app
    let oauthRedirect;
    if (redirectUrl) {
      const baseUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
      oauthRedirect = `${baseUrl}/auth/mobile-callback?appRedirect=${encodeURIComponent(redirectUrl)}`;
    }

    const result = await signInWithGoogle(oauthRedirect);
    
    if (result.url) {
      console.log('Redirecting to Google OAuth:', result.url);
      return res.json({ url: result.url });
    }

    if (result.user) {
      console.log('User signed in with Google:', {
        id: result.user.id,
        email: result.user.email,
        user_metadata: result.user.user_metadata,
        app_metadata: result.user.app_metadata,
        created_at: result.user.created_at,
        updated_at: result.user.updated_at,
        last_sign_in_at: result.user.last_sign_in_at,
        role: result.user.role,
        identities: result.user.identities,
        avatar_url: result.user.user_metadata?.avatar_url,
        full_name: result.user.user_metadata?.full_name
      });
    }

    console.log('Google signin successful:', {
      user: result.user,
      session: result.session ? {
        access_token: result.session.access_token ? 'present' : 'missing',
        refresh_token: result.session.refresh_token ? 'present' : 'missing',
        expires_at: result.session.expires_at
      } : null
    });
    
    res.json(result);
  } catch (error) {
    console.error('Google auth error:', {
      message: error.message,
      code: error.code,
      details: error.details
    });
    res.status(400).json({ error: error.message || 'Google authentication failed' });
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ error: 'No code provided' });
    }

    const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;

    res.send(`<!DOCTYPE html><html><head><title>Signed In</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
      <div style="text-align:center"><h1>Sign In Successful</h1><p>You can return to the app now.</p></div>
    </body></html>`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.send(`<!DOCTYPE html><html><head><title>Sign In Failed</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
      <div style="text-align:center"><h1>Sign In Failed</h1><p>${error.message}</p></div>
    </body></html>`);
  }
});

app.get('/auth/user', authenticateToken, async (req, res) => {
  try {
    console.log('Fetching current user');
    // req.user is already set by authenticateToken middleware via supabase.auth.getUser(token)
    // Fetch full user data (including metadata) using admin API
    const { data: { user: fullUser }, error: userError } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
    if (userError) throw userError;

    const user = fullUser || req.user;
    const userData = {
      id: user.id,
      email: user.email,
      user_metadata: user.user_metadata || {},
      app_metadata: user.app_metadata || {},
      created_at: user.created_at,
      updated_at: user.updated_at
    };

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('subscription_status')
      .eq('id', user.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      throw profileError;
    }

    // Prefer live Stripe state for reliability. If it fails, fall back to DB state.
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
    const IN_APP_TRIAL_DAYS = 7;
    const accountCreatedAt = user.created_at ? new Date(user.created_at) : null;
    const accountAgeMs = accountCreatedAt ? now.getTime() - accountCreatedAt.getTime() : Infinity;
    const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
    const inAppTrialActive = subscriptionStatus === 'no_subscription' && accountAgeDays < IN_APP_TRIAL_DAYS;
    const inAppTrialDaysRemaining = inAppTrialActive
      ? Math.ceil(IN_APP_TRIAL_DAYS - accountAgeDays)
      : 0;

    const subscriptionActive = ['active', 'trialing'].includes(subscriptionStatus);
    const hasAccess = subscriptionActive || inAppTrialActive;
    const trialActive = subscriptionStatus === 'trialing' || inAppTrialActive;
    const reason = subscriptionActive
      ? (subscriptionStatus === 'trialing' ? 'trial_active' : 'subscription_active')
      : inAppTrialActive
        ? 'in_app_trial'
        : 'no_access';
    const trialDaysRemaining = subscriptionStatus === 'trialing' && stripeTrialEndsAt && stripeTrialEndsAt > now
      ? Math.ceil((stripeTrialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : inAppTrialDaysRemaining;

    const access = {
      hasAccess,
      reason,
      subscriptionStatus,
      trialActive,
      trialDaysRemaining,
      trialEndsAt: stripeTrialEndsAt ? stripeTrialEndsAt.toISOString() : null
    };
    
    console.log('User data retrieved:', {
      ...userData,
      user_metadata: userData.user_metadata ? 'present' : 'missing',
      access
    });
    
    res.json({ user: userData, access });
  } catch (error) {
    console.error('Get user error:', {
      message: error.message,
      code: error.code,
      details: error.details
    });
    res.status(400).json({ error: error.message || 'Failed to get user' });
  }
});

app.post('/auth/signout', async (req, res) => {
  try {
    console.log('Attempting signout');
    
    const result = await signOut();
    
    res.clearCookie('session');
    
    console.log('Signout successful');
    res.json({ success: true, message: 'Successfully signed out' });
  } catch (error) {
    console.error('Signout error:', {
      message: error.message,
      code: error.code,
      details: error.details
    });
    res.json({ success: true, message: 'Successfully signed out' });
  }
});

app.get('/auth/session', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const session = token
      ? {
          access_token: token,
          user: {
            id: req.user.id,
            email: req.user.email
          }
        }
      : null;

    console.log('Session retrieved:', session ? { access_token: 'present' } : null);
    res.json({ session });
  } catch (error) {
    console.error('Get session error:', {
      message: error.message,
      code: error.code,
      details: error.details
    });
    res.status(400).json({ error: error.message || 'Failed to get session' });
  }
});

app.post('/lifestyle/score', authenticateToken, async (req, res) => {
  try {
    let onboardingData = req.body;
    if (!onboardingData || Object.keys(onboardingData).length === 0) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('onboarding_data')
        .eq('id', req.user.id)
        .single();
      if (profileError || !profile?.onboarding_data) {
      return res.status(400).json({ error: 'Onboarding data is required' });
      }
      onboardingData = profile.onboarding_data;
    }

    // Validate onboardingData fields
    const requiredFields = ['goal', 'diet', 'hadTest', 'age', 'spermCount', 'exerciseDays', 'smoke', 'alcohol', 'sleep', 'stress', 'sunlightExposure', 'supplements', 'dataLog'];
    for (const field of requiredFields) {
      if (onboardingData[field] === undefined) {
        return res.status(400).json({ error: `Missing field: ${field}` });
      }
    }

    console.log('\n=== LIFESTYLE SCORE CALCULATION ===');
    console.log('User ID:', req.user.id);
    console.log('\nOnboarding Data:');
    console.log(JSON.stringify(onboardingData, null, 2));

    let scoreData;
    try {
      scoreData = calculateLifestyleScore(onboardingData);
    } catch (err) {
      console.error('Error in calculateLifestyleScore:', err, onboardingData);
      return res.status(500).json({ error: 'Failed to calculate lifestyle score', details: err.message });
    }
    
    console.log('\nCalculated Scores:');
    console.log('Overall Score:', scoreData.overallScore);
    console.log('Yearly Decline Rate:', scoreData.yearlyDeclineRate + '%');
    console.log('Impact Multiplier:', scoreData.impactMultiplier);
    
    console.log('\nFactor Scores:');
    Object.entries(scoreData.factorScores).forEach(([factor, score]) => {
      console.log(`${factor}: ${score}`);
    });
    
    console.log('\nFactor Descriptions:');
    Object.entries(scoreData.factorDescriptions).forEach(([factor, description]) => {
      console.log(`${factor}: ${description}`);
    });
    
    console.log('\nRecommendations:');
    scoreData.recommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec}`);
    });
    
    console.log('\n=== END LIFESTYLE SCORE ===\n');
    
    const { data, error } = await supabaseAdmin
      .from('lifestyle_scores')
      .insert([
        {
          user_id: req.user.id,
          overall_score: scoreData.overallScore,
          yearly_decline_rate: scoreData.yearlyDeclineRate,
          impact_multiplier: scoreData.impactMultiplier,
          factor_scores: scoreData.factorScores,
          factor_descriptions: scoreData.factorDescriptions,
          recommendations: scoreData.recommendations,
          created_at: new Date().toISOString()
        }
      ])
      .select();

    if (error) {
      console.error('Error storing lifestyle score:', error);
    }

    res.json(scoreData);
  } catch (error) {
    console.error('Lifestyle score calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate lifestyle score' });
  }
});

app.get('/lifestyle/score', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('lifestyle_scores')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching lifestyle score:', error);
      return res.status(500).json({ error: 'Failed to fetch lifestyle score' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No lifestyle score found' });
    }

    res.json(data[0]);
  } catch (error) {
    console.error('Error fetching lifestyle score:', error);
    res.status(500).json({ error: 'Failed to fetch lifestyle score' });
  }
});

app.get('/daily-missions', authenticateToken, async (req, res) => {
  try {
    const data = await getDailyMissions(req.user.id);
    res.json(data);
  } catch (error) {
    console.error('Error in daily missions endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch daily missions' });
  }
});

app.post('/daily-missions', authenticateToken, async (req, res) => {
  try {
    const { date, missions } = req.body;
    
    // Prevent unchecking completed missions
    const existingMissions = await getTodayDailyMissions(req.user.id);
    if (existingMissions) {
      // Check if any completed missions are being unchecked
      const missionFields = ['sleep_completed', 'exercise_completed', 'sunlight_completed', 'diet_completed', 'alcohol_avoided', 'cold_exposure_completed', 'no_porn_masturbation'];
      const isUnchecking = missionFields.some(field => 
        existingMissions[field] === true && missions[field] === false
      );
      
      if (isUnchecking) {
        return res.status(400).json({ 
          error: 'Cannot uncheck completed missions. Once a mission is completed, it cannot be undone.' 
        });
      }
    }
    
    const result = await saveDailyMissions(req.user.id, date, missions);
    
    try {
      console.log('🔍 Checking if progress should be saved...');
      console.log('User ID:', req.user.id);
      console.log('Date:', date);
      console.log('Missions:', missions);
      
      const { data: profileData, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('onboarding_data')
        .eq('id', req.user.id)
        .single();

      if (profileError) {
        console.log('❌ Error fetching onboarding data:', profileError);
      } else if (!profileData?.onboarding_data) {
        console.log('⚠️  No onboarding data found for user, skipping progress save');
      } else {
        console.log('✅ Onboarding data found, checking if all missions completed...');
        const onboardingData = profileData.onboarding_data;
        
        const progressResult = await checkAndSaveDailyProgress(req.user.id, date, missions, onboardingData);
        
        if (progressResult.success) {
          console.log('✅ Daily progress automatically saved:', progressResult.metrics);
        } else {
          console.log('ℹ️  Progress not saved:', progressResult.message);
        }
      }
    } catch (progressError) {
      console.error('❌ Error checking daily progress:', progressError);
      console.error('Error details:', {
        message: progressError.message,
        stack: progressError.stack
      });
    }

    // Process rank update for daily missions
    try {
      console.log('🏆 Processing rank update for daily missions...');
      // Get user's lifestyle score for bonus calculation
      const { data: lifestyleData } = await supabaseAdmin
        .from('lifestyle_scores')
        .select('overall_score')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const lifestyleScore = lifestyleData?.overall_score || null;
      // The daily points cap (max 50) is enforced in rankSystem.js/calculateDailyPoints
      const rankUpdate = await processDailyRankUpdate(req.user.id, date, missions, lifestyleScore);
      
      console.log('✅ Rank update completed:', {
        pointsEarned: rankUpdate.pointsEarned,
        newRank: rankUpdate.rankInfo.name,
        totalPoints: rankUpdate.newTotalPoints
      });
      
      // Add rank info to response
      result.rankUpdate = {
        pointsEarned: rankUpdate.pointsEarned,
        newRank: rankUpdate.rankInfo.name,
        totalPoints: rankUpdate.newTotalPoints,
        pointsToNextRank: rankUpdate.rank.points_to_next_rank
      };
      
    } catch (rankError) {
      console.error('⚠️  Rank update failed:', rankError);
      // Don't fail the mission save if rank update fails
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error in save daily missions endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to save daily missions' });
  }
});

app.post('/daily-missions/check-progress', authenticateToken, async (req, res) => {
  try {
    const { date, missions, onboardingData } = req.body;
    
    if (!date || !missions || !onboardingData) {
      return res.status(400).json({ error: 'Date, missions, and onboarding data are required' });
    }

    const result = await checkAndSaveDailyProgress(req.user.id, date, missions, onboardingData);
    res.json(result);
  } catch (error) {
    console.error('Error in check daily progress endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to check daily progress' });
  }
});

app.get('/daily-missions/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await getDailyMissionStats(req.user.id);
    res.json(stats);
  } catch (error) {
    console.error('Error in daily missions stats endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch daily mission stats' });
  }
});

app.get('/daily-missions/today', authenticateToken, async (req, res) => {
  try {
    const data = await getTodayDailyMissions(req.user.id);
    res.json(data);
  } catch (error) {
    console.error('Error in today\'s daily missions endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch today\'s daily missions' });
  }
});

app.get('/daily-missions/completed/:date', authenticateToken, async (req, res) => {
  try {
    const { date } = req.params;
    const isCompleted = await checkMissionsCompleted(req.user.id, date);
    res.json({ completed: isCompleted });
  } catch (error) {
    console.error('Error in check missions completion endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to check missions completion' });
  }
});

app.get('/progress', authenticateToken, async (req, res) => {
  try {
    const data = await getUserProgress(req.user.id);
    const enriched = (data || []).map(entry => ({
      ...entry,
      health_data: enrichHealthDataForUnits(entry.health_data)
    }));
    res.json(enriched);
  } catch (error) {
    console.error('Error in progress endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch progress data' });
  }
});

app.post('/progress', authenticateToken, async (req, res) => {
  try {
    const { date, healthData } = req.body;
    const result = await saveUserProgress(req.user.id, date, healthData);
    res.json(result);
  } catch (error) {
    console.error('Error in save progress endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to save progress data' });
  }
});

app.get('/progress/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await getProgressStats(req.user.id);
    res.json(stats);
  } catch (error) {
    console.error('Error in progress stats endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch progress stats' });
  }
});

app.get('/progress/today', authenticateToken, async (req, res) => {
  try {
    const data = await getTodayProgress(req.user.id);
    res.json(data);
  } catch (error) {
    console.error('Error in today\'s progress endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch today\'s progress' });
  }
});

app.post('/user/onboarding', authenticateToken, async (req, res) => {
  try {
    const onboardingData = req.body;
    
    if (!onboardingData) {
      return res.status(400).json({ error: 'Onboarding data is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .upsert([
        {
          id: req.user.id,
          onboarding_data: onboardingData,
          updated_at: new Date().toISOString()
        }
      ], {
        onConflict: 'id'
      })
      .select();

    if (error) {
      console.error('Error storing onboarding data:', error);
      return res.status(500).json({ error: 'Failed to store onboarding data' });
    }

    // Automatically populate progress from existing daily missions
    try {
      console.log('🔄 Auto-populating progress after onboarding completion...');
      const populateResult = await populateProgressFromMissions(req.user.id);
      
      if (populateResult.success) {
        console.log('✅ Auto-progress population successful:', populateResult.message);
      } else {
        console.log('ℹ️  Auto-progress population skipped:', populateResult.message);
      }
    } catch (populateError) {
      console.error('⚠️  Auto-progress population failed:', populateError);
      // Don't fail the onboarding if progress population fails
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('Error storing onboarding data:', error);
    res.status(500).json({ error: 'Failed to store onboarding data' });
  }
});

app.get('/user/onboarding', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('onboarding_data')
      .eq('id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching onboarding data:', error);
      return res.status(500).json({ error: 'Failed to fetch onboarding data' });
    }

    res.json({ data: data?.onboarding_data || null });
  } catch (error) {
    console.error('Error fetching onboarding data:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding data' });
  }
});

app.get('/user/preferences', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('units_preference')
      .eq('id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching user preferences:', error);
      return res.status(500).json({ error: 'Failed to fetch user preferences' });
    }

    const unitsPreference = data?.units_preference === 'imperial' ? 'imperial' : 'metric';
    res.json({ unitsPreference });
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    res.status(500).json({ error: 'Failed to fetch user preferences' });
  }
});

app.patch('/user/preferences', authenticateToken, async (req, res) => {
  try {
    const { unitsPreference } = req.body;

    if (unitsPreference !== 'metric' && unitsPreference !== 'imperial') {
      return res.status(400).json({ error: 'Invalid unitsPreference. Allowed: metric|imperial' });
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .upsert([
        {
          id: req.user.id,
          units_preference: unitsPreference,
          updated_at: new Date().toISOString()
        }
      ], {
        onConflict: 'id'
      })
      .select();

    if (error) {
      console.error('Error updating user preferences:', error);
      return res.status(500).json({ error: 'Failed to update user preferences' });
    }

    res.json({ success: true, unitsPreference });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    res.status(500).json({ error: 'Failed to update user preferences' });
  }
});

app.post('/subscription/checkout', authenticateToken, async (req, res) => {
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

app.post('/subscription/portal', authenticateToken, async (req, res) => {
  try {
    const session = await createCustomerPortalSession(req.user.id);
    res.json({ session });
  } catch (error) {
    console.error('Error creating customer portal session:', error);
    res.status(500).json({ error: error.message || 'Failed to create customer portal session' });
  }
});

app.get('/subscription/status', authenticateToken, async (req, res) => {
  try {
    const subscription = await getSubscriptionStatus(req.user.id);
    res.json(subscription);
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch subscription status' });
  }
});

app.post('/subscription/cancel', authenticateToken, async (req, res) => {
  try {
    const subscription = await cancelSubscription(req.user.id);
    res.json({ success: true, subscription });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel subscription' });
  }
});

app.post('/subscription/reactivate', authenticateToken, async (req, res) => {
  try {
    const subscription = await reactivateSubscription(req.user.id);
    res.json({ success: true, subscription });
  } catch (error) {
    console.error('Error reactivating subscription:', error);
    res.status(500).json({ error: error.message || 'Failed to reactivate subscription' });
  }
});

// Stripe webhook endpoint
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
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
});

// Stripe redirect pages - simple HTML pages the WebView detects via URL params
app.get('/subscription/success', (req, res) => {
  const sessionId = req.query.session_id || '';
  res.send(`<!DOCTYPE html><html><head><title>Payment Successful</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
    <div style="text-align:center"><h1>Payment Successful!</h1><p>Your subscription is now active.</p></div>
  </body></html>`);
});

app.get('/subscription/cancel', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Payment Canceled</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
    <div style="text-align:center"><h1>Payment Canceled</h1><p>You can try again anytime.</p></div>
  </body></html>`);
});

app.get('/subscription/portal-return', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Subscription Updated</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
    <div style="text-align:center"><h1>Subscription Updated</h1><p>You can close this window and return to the app.</p></div>
  </body></html>`);
});

// Premium features endpoints (require subscription)
app.get('/premium/features', authenticateToken, requireSubscription, async (req, res) => {
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

app.post('/progress/populate-from-missions', authenticateToken, async (req, res) => {
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

// Rank system endpoints
app.get('/rank', authenticateToken, async (req, res) => {
  try {
    const rankData = await getUserRank(req.user.id);
    res.json(rankData);
  } catch (error) {
    console.error('Error fetching user rank:', error);
    res.status(500).json({ error: 'Failed to fetch user rank' });
  }
});

app.get('/rank/leaderboard', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = await getLeaderboard(limit);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.get('/rank/daily-points', authenticateToken, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    const { data: dailyPoints, error } = await supabaseAdmin
      .from('daily_points')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('date', targetDate)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json(dailyPoints || null);
  } catch (error) {
    console.error('Error fetching daily points:', error);
    res.status(500).json({ error: 'Failed to fetch daily points' });
  }
});

// Profile management endpoints
app.get('/profile', authenticateToken, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.id);
    res.json(profile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

app.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { display_name, bio } = req.body;
    
    // Validate input
    if (display_name && display_name.length > 100) {
      return res.status(400).json({ error: 'Display name must be 100 characters or less' });
    }
    
    if (bio && bio.length > 500) {
      return res.status(400).json({ error: 'Bio must be 500 characters or less' });
    }

    const updatedProfile = await updateUserProfile(req.user.id, {
      display_name,
      bio
    });

    res.json(updatedProfile);
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

app.post('/profile/picture', authenticateToken, async (req, res) => {
  try {
    const { image, fileName, mimeType } = req.body;
    
    if (!image || !fileName || !mimeType) {
      return res.status(400).json({ 
        error: 'Missing required fields: image (base64), fileName, mimeType' 
      });
    }

    // Validate that it's a base64 image
    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ 
        error: 'Invalid image format. Must be a base64 encoded image.' 
      });
    }

    // Validate mime type
    if (!mimeType.startsWith('image/')) {
      return res.status(400).json({ 
        error: 'Invalid mime type. Only image files are allowed.' 
      });
    }

    // Convert base64 to buffer
    const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, '');
    const fileBuffer = Buffer.from(base64Data, 'base64');

    // Validate file size (5MB limit)
    if (fileBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ 
        error: 'File size too large. Maximum size is 5MB.' 
      });
    }

    // Get current profile to check if there's an existing picture
    const currentProfile = await getUserProfile(req.user.id);
    let oldPictureUrl = null;

    // Upload new picture
    const pictureUrl = await uploadProfilePicture(
      req.user.id,
      fileBuffer,
      fileName,
      mimeType
    );

    // Update profile with new picture URL
    const updatedProfile = await updateUserProfile(req.user.id, {
      profile_picture_url: pictureUrl
    });

    // Delete old picture if it exists
    if (currentProfile.profile_picture_url) {
      try {
        await deleteProfilePicture(req.user.id, currentProfile.profile_picture_url);
      } catch (deleteError) {
        console.error('Error deleting old profile picture:', deleteError);
        // Don't fail the request if deletion fails
      }
    }

    res.json({
      profile: updatedProfile,
      picture_url: pictureUrl
    });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(500).json({ error: 'Failed to upload profile picture' });
  }
});

app.delete('/profile/picture', authenticateToken, async (req, res) => {
  try {
    const currentProfile = await getUserProfile(req.user.id);
    
    if (!currentProfile.profile_picture_url) {
      return res.status(404).json({ error: 'No profile picture found' });
    }

    // Delete the picture from storage
    await deleteProfilePicture(req.user.id, currentProfile.profile_picture_url);

    // Update profile to remove picture URL
    const updatedProfile = await updateUserProfile(req.user.id, {
      profile_picture_url: null
    });

    res.json({
      success: true,
      profile: updatedProfile
    });
  } catch (error) {
    console.error('Error deleting profile picture:', error);
    res.status(500).json({ error: 'Failed to delete profile picture' });
  }
});

app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://192.168.0.232:${PORT}`);
}); 