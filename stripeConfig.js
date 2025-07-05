import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

// Subscription configuration
const SUBSCRIPTION_CONFIG = {
  MONTHLY_PRICE_ID: process.env.STRIPE_MONTHLY_PRICE_ID,
  TRIAL_DAYS: 14,
  CURRENCY: 'usd',
  SUCCESS_URL: `${process.env.FRONTEND_URL}/subscription/success`,
  CANCEL_URL: `${process.env.FRONTEND_URL}/subscription/cancel`,
};

// Validate Stripe configuration
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

if (!process.env.STRIPE_MONTHLY_PRICE_ID) {
  throw new Error('STRIPE_MONTHLY_PRICE_ID is required');
}

export { stripe, SUBSCRIPTION_CONFIG }; 