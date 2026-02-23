import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Client for auth operations (uses anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});

// Service role client for server-side operations (bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Auth helper functions
export const signUpWithEmail = async (email, password) => {
  try {
    console.log('Starting signup process for:', email);

    // Proceed with signup
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.RENDER_EXTERNAL_URL || 'https://pmabackend-osap.onrender.com'}/auth/email-confirmed`,
        data: {
          email_confirmed: false
        }
      },
    });

    if (error) {
      console.error('Supabase signup error:', {
        message: error.message,
        code: error.code,
        details: error.details
      });
      throw error;
    }

    console.log('Signup successful');
    const session = data.session || null;

    console.log('Supabase signup response:', {
      user: data.user,
      session: session ? {
        access_token: session.access_token ? 'present' : 'missing',
        refresh_token: session.refresh_token ? 'present' : 'missing',
        expires_at: session.expires_at
      } : null
    });

    return {
      user: data.user,
      session: session
    };
  } catch (error) {
    console.error('Supabase signup error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      stack: error.stack
    });
    throw error;
  }
};

export const signInWithEmail = async (email, password) => {
  try {
    console.log('Starting signin process for:', email);

    // Attempt sign in
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Supabase signin error:', {
        message: error.message,
        code: error.code,
        details: error.details
      });
      throw error;
    }

    console.log('Signin successful');
    const session = data.session || null;

    console.log('Supabase signin response:', {
      user: data.user,
      session: session ? {
        access_token: session.access_token ? 'present' : 'missing',
        refresh_token: session.refresh_token ? 'present' : 'missing',
        expires_at: session.expires_at
      } : null
    });

    return {
      user: data.user,
      session: session
    };
  } catch (error) {
    console.error('Supabase signin error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      stack: error.stack
    });
    throw error;
  }
};

export const signInWithGoogle = async (redirectUrl) => {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl || `${process.env.RENDER_EXTERNAL_URL || 'https://pmabackend-osap.onrender.com'}/auth/mobile-callback`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
        skipBrowserRedirect: true
      },
    });

    if (error) throw error;

    // For OAuth, we need to return the URL for the frontend to redirect to
    if (data?.url) {
      return { url: data.url };
    }

    // If we have a session, return the user and session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    return {
      user: data.user,
      session: session
    };
  } catch (error) {
    console.error('Supabase Google signin error:', error);
    throw error;
  }
};

export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Supabase signout error:', error);
    throw error;
  }
};
