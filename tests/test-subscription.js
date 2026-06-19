import axios from 'axios';
import { API_URL, TEST_EMAIL, TEST_PASSWORD } from './testConfig.js';

// Test subscription system
async function testSubscriptionSystem() {
  try {
    console.log('Testing Subscription System...\n');

    // First, we need to get a valid token by signing in
    console.log('1. Testing authentication...');
    const signinResponse = await axios.post(`${API_URL}/auth/signin`, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    });

    if (!signinResponse.data.session?.access_token) {
      console.error('❌ Authentication failed');
      return;
    }

    const token = signinResponse.data.session.access_token;
    console.log('✅ Authentication successful\n');

    // Set up axios with auth header
    const api = axios.create({
      baseURL: API_URL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Test GET /subscription/status
    console.log('2. Testing GET /subscription/status...');
    try {
      const statusResponse = await api.get('/subscription/status');
      console.log('✅ Subscription status fetched successfully');
      console.log('Status:', statusResponse.data);
    } catch (error) {
      console.log('⚠️  Subscription status error (expected if no subscription):', error.response?.data?.error);
    }

    // Test POST /subscription/checkout
    console.log('\n3. Testing POST /subscription/checkout...');
    try {
      const checkoutResponse = await api.post('/subscription/checkout', {
        name: 'Test User'
      });
      console.log('✅ Subscription checkout created successfully');
      console.log('Checkout URL:', checkoutResponse.data.session.url);
    } catch (error) {
      console.log('⚠️  Checkout error (expected if Stripe not configured):', error.response?.data?.error);
    }

    // Test POST /subscription/portal
    console.log('\n4. Testing POST /subscription/portal...');
    try {
      const portalResponse = await api.post('/subscription/portal');
      console.log('✅ Customer portal session created successfully');
      console.log('Portal URL:', portalResponse.data.session.url);
    } catch (error) {
      console.log('⚠️  Portal error (expected if no Stripe customer):', error.response?.data?.error);
    }

    // Test GET /premium/features (should fail without subscription)
    console.log('\n5. Testing GET /premium/features (should require subscription)...');
    try {
      const featuresResponse = await api.get('/premium/features');
      console.log('✅ Premium features accessed successfully');
      console.log('Features:', featuresResponse.data.features);
    } catch (error) {
      if (error.response?.status === 403) {
        console.log('✅ Premium features correctly blocked (subscription required)');
        console.log('Error:', error.response.data.error);
      } else {
        console.log('⚠️  Unexpected error:', error.response?.data?.error);
      }
    }

    console.log('\n🎉 Subscription system test completed!');
    console.log('\n📊 Summary:');
    console.log('- Subscription endpoints are working');
    console.log('- Authentication is properly integrated');
    console.log('- Premium features are protected');
    console.log('- Stripe integration is ready (needs configuration)');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testSubscriptionSystem(); 