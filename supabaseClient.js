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
    
    // First check if user already exists
    const { data: existingUser, error: checkError } = await supabase.auth.getUser();
    if (checkError) {
      console.log('No existing user found, proceeding with signup');
    } else if (existingUser?.user?.email === email) {
      console.log('User already exists, attempting sign in instead');
      return await signInWithEmail(email, password);
    }

    // Proceed with signup
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
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

    console.log('Signup successful, getting session...');
    
    // Get the session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error('Failed to get session after signup:', sessionError);
      throw sessionError;
    }

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
    
    // First check if user exists
    const { data: existingUser, error: checkError } = await supabase.auth.getUser();
    if (checkError) {
      console.log('No existing user found');
    } else {
      console.log('Found existing user:', existingUser.user?.email);
    }

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

    console.log('Signin successful, getting session...');
    
    // Get the session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error('Failed to get session after signin:', sessionError);
      throw sessionError;
    }

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

export const signInWithGoogle = async () => {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
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

export const getCurrentUser = async () => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    
    // Ensure we have the full user data including metadata
    if (user) {
      const { data: { user: fullUser }, error: userError } = await supabase.auth.admin.getUserById(user.id);
      if (userError) throw userError;
      return fullUser;
    }
    
    return user;
  } catch (error) {
    console.error('Supabase getCurrentUser error:', error);
    throw error;
  }
};

export const getSession = async () => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  } catch (error) {
    console.error('Supabase getSession error:', error);
    throw error;
  }
};

export const refreshSession = async () => {
  try {
    const { data: { session }, error } = await supabase.auth.refreshSession();
    if (error) throw error;
    return session;
  } catch (error) {
    console.error('Supabase refreshSession error:', error);
    throw error;
  }
};

// JWT specific functions
export const getJWT = async () => {
  const session = await getSession();
  return session ? session.access_token : null;
};

export const setJWT = async (jwt) => {
  await AsyncStorage.setItem('jwt', jwt);
};
