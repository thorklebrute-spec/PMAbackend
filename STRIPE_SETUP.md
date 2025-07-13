# Stripe Subscription Integration Setup

This guide will help you set up the Stripe subscription integration for the Primal Male App.

## Prerequisites

1. **Stripe Account**: Create a Stripe account at [stripe.com](https://stripe.com)
2. **Supabase Project**: Ensure your Supabase project is set up with the required tables

## Step 1: Stripe Dashboard Setup

### 1.1 Create a Product and Price
1. Go to your Stripe Dashboard
2. Navigate to **Products** → **Add Product**
3. Create a product named "Primal Male Pro"
4. Add a recurring price:
   - **Price**: $9.99/month (or your desired price)
   - **Billing**: Monthly
   - **Trial**: 14 days (optional)
5. Copy the **Price ID** (starts with `price_`)

### 1.2 Configure Webhooks
1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Set the endpoint URL to: `https://your-backend-url.com/webhook/stripe`
4. Select these events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the **Webhook signing secret** (starts with `whsec_`)

## Step 2: Environment Variables

Create a `.env` file in the backend directory with these variables:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_... (or sk_live_... for production)
STRIPE_MONTHLY_PRICE_ID=price_... (from step 1.1)
STRIPE_WEBHOOK_SECRET=whsec_... (from step 1.2)

# Frontend URL (for OAuth redirects)
FRONTEND_URL=http://localhost:8081

# Server Configuration
PORT=3000
```

## Step 3: Database Schema

Ensure your Supabase database has the required tables. The subscription integration uses the `user_profiles` table with these additional columns:

```sql
-- Add these columns to your user_profiles table if they don't exist
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'no_subscription',
ADD COLUMN IF NOT EXISTS subscription_id TEXT;
```

## Step 4: Testing the Integration

### 4.1 Test Environment Variables
```bash
npm run test:stripe
```

### 4.2 Test the Backend
1. Start the backend server: `npm start`
2. The server should start without errors
3. Check the console for any missing environment variables

### 4.3 Test the Frontend
1. Open the app and navigate to Settings
2. Tap "Upgrade to Pro"
3. You should see an alert with the Stripe checkout URL
4. Tap "Continue" to open the checkout in your browser

## Step 5: Production Deployment

### 5.1 Update Environment Variables
- Use production Stripe keys (`sk_live_` instead of `sk_test_`)
- Update `FRONTEND_URL` to your production frontend URL
- Update webhook endpoint URL to your production backend URL

### 5.2 Update Webhook Endpoint
1. Go to Stripe Dashboard → Webhooks
2. Update the endpoint URL to your production URL
3. Test the webhook endpoint

## Troubleshooting

### Common Issues

1. **"Missing Supabase environment variables"**
   - Ensure all Supabase variables are set in your `.env` file

2. **"STRIPE_SECRET_KEY is required"**
   - Check that your Stripe secret key is correctly set

3. **"No checkout session URL received"**
   - Verify your Stripe price ID is correct
   - Check Stripe dashboard for any errors

4. **Webhook not working**
   - Ensure the webhook URL is accessible from the internet
   - Check that the webhook secret is correct
   - Verify the webhook events are properly configured

### Testing with Stripe Test Cards

Use these test card numbers for testing:
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires Authentication**: `4000 0025 0000 3155`

## API Endpoints

The integration provides these endpoints:

- `POST /subscription/checkout` - Create Stripe checkout session
- `POST /subscription/portal` - Create customer portal session
- `GET /subscription/status` - Get subscription status
- `POST /webhook/stripe` - Handle Stripe webhooks

## Security Notes

- Never commit your `.env` file to version control
- Use environment variables for all sensitive data
- Regularly rotate your Stripe API keys
- Monitor webhook events in your Stripe dashboard 