import dotenv from 'dotenv';
import { createSubscriptionCheckout, getSubscriptionStatus } from './subscriptionService.js';

// Load environment variables
dotenv.config();

const testStripeIntegration = async () => {
  try {
    console.log('🧪 Testing Stripe Integration...');
    
    // Test 1: Check environment variables
    console.log('\n1. Checking environment variables...');
    const requiredVars = [
      'STRIPE_SECRET_KEY',
      'STRIPE_MONTHLY_PRICE_ID',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];
    
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.log('❌ Missing environment variables:', missingVars);
      console.log('Please create a .env file with the required variables.');
      return;
    }
    
    console.log('✅ All required environment variables are set');
    
    // Test 2: Test subscription checkout creation
    console.log('\n2. Testing subscription checkout creation...');
    const testUserId = 'test-user-id';
    const testEmail = 'test@example.com';
    const testName = 'Test User';
    
    try {
      const session = await createSubscriptionCheckout(testUserId, testEmail, testName);
      console.log('✅ Checkout session created successfully');
      console.log('Session URL:', session.url);
      console.log('Session ID:', session.id);
    } catch (error) {
      console.log('❌ Failed to create checkout session:', error.message);
    }
    
    // Test 3: Test subscription status
    console.log('\n3. Testing subscription status...');
    try {
      const status = await getSubscriptionStatus(testUserId);
      console.log('✅ Subscription status retrieved:', status.status);
    } catch (error) {
      console.log('❌ Failed to get subscription status:', error.message);
    }
    
    console.log('\n🎉 Stripe integration test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
};

// Run the test
testStripeIntegration(); 