import { Router } from 'express';
import { supabase, supabaseAdmin, signUpWithEmail, signInWithEmail, signInWithGoogle, signOut } from '../config/supabase.js';
import { getAuthUserPayload } from '../services/authService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.post('/auth/signup', async (req, res) => {
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

router.post('/auth/signin', async (req, res) => {
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

router.post('/auth/resend-confirmation', async (req, res) => {
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


router.post('/auth/forgot-password', async (req, res) => {
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
    const baseUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
    const redirectTo = `${baseUrl}/auth/mobile-callback?appRedirect=${encodeURIComponent('primalmale://reset-password')}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
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

router.post('/auth/reset-password', async (req, res) => {
  try {
    const { password, access_token } = req.body;

    if (!password || !access_token) {
      return res.status(400).json({ error: 'Password and access_token are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(access_token);
    if (userError || !user) {
      console.error('Reset password token validation failed:', userError?.message);
      return res.status(401).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password,
    });

    if (updateError) {
      console.error('Reset password update failed:', updateError.message);
      return res.status(400).json({ error: updateError.message || 'Failed to reset password' });
    }

    console.log('Password reset successful for user:', user.email);
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Reset password unexpected error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.post('/auth/refresh', async (req, res) => {
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

router.get('/auth/email-confirmed', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Email Confirmed</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#121212;color:#fff;">
    <div style="text-align:center"><h1>Email Confirmed!</h1><p>You can now open the app and sign in.</p></div>
  </body></html>`);
});

// Mobile OAuth callback - serves an HTML page that reads tokens from the
// URL fragment and redirects to the Expo app via deep link
router.get('/auth/mobile-callback', (req, res) => {
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

router.post('/auth/google', async (req, res) => {
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

router.get('/auth/callback', async (req, res) => {
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

router.get('/auth/user', authenticateToken, async (req, res) => {
  try {
    console.log('Fetching current user');
    res.json(await getAuthUserPayload(req.user.id));
  } catch (error) {
    console.error('Get user error:', {
      message: error.message,
      code: error.code,
      details: error.details
    });
    res.status(400).json({ error: error.message || 'Failed to get user' });
  }
});


router.post('/auth/signout', async (req, res) => {
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

router.get('/auth/session', authenticateToken, async (req, res) => {
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

export default router;
