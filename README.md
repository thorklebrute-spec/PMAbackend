# Backend Setup for React Native Project

This backend is built using Supabase for authentication and database management.

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Supabase account

## Setup Instructions

1. Install dependencies:
```bash
npm install @supabase/supabase-js
```

2. Create a `.env` file in the root directory with your Supabase credentials:
```
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. Set up Supabase:
   - Create a new project in Supabase
   - Enable Email/Password authentication in Authentication > Providers
   - Enable Google OAuth in Authentication > Providers
   - Configure Google OAuth credentials in Google Cloud Console
   - Add your Google OAuth credentials to Supabase

4. Run the database migrations:
   - Execute the SQL files in the `sql` directory in your Supabase SQL editor
   - Start with `init_schema.sql`

## Authentication Features

- Email/Password authentication
- Google OAuth authentication
- User profile management
- Session management

## Available Functions

- `signUpWithEmail(email, password)`: Register a new user
- `signInWithEmail(email, password)`: Sign in with email/password
- `signInWithGoogle()`: Sign in with Google
- `signOut()`: Sign out the current user
- `getCurrentUser()`: Get the current authenticated user

## Security

- Row Level Security (RLS) is enabled on all tables
- User data is protected by policies
- Authentication is handled securely through Supabase
