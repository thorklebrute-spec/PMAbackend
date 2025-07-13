import axios from 'axios';

const API_URL = 'http://192.168.0.232:3000';

// Test that missions cannot be unchecked once completed
async function testMissionUnchecking() {
  try {
    console.log('Testing Mission Unchecking Prevention...\n');

    // First, we need to get a valid token by signing in
    console.log('1. Testing authentication...');
    const signinResponse = await axios.post(`${API_URL}/auth/signin`, {
      email: 'jesse.mashoana@gmail.com',
      password: 'Marshall@32'
    });

    if (!signinResponse.data.session?.access_token) {
      console.error('❌ Authentication failed');
      return;
    }

    const token = signinResponse.data.session.access_token;
    console.log('✅ Authentication successful');

    // Test completing a mission
    console.log('\n2. Testing mission completion...');
    
    const today = new Date().toISOString().split('T')[0];
    const missionData = {
      sleep_completed: true,
      exercise_completed: false,
      sunlight_completed: false,
      diet_completed: false,
      alcohol_avoided: false,
      no_porn_masturbation: false
    };

    const completeResponse = await axios.post(`${API_URL}/daily-missions`, {
      date: today,
      missions: missionData
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Mission completed successfully');

    // Test trying to uncheck the completed mission
    console.log('\n3. Testing mission unchecking (should be prevented)...');
    
    const uncheckData = {
      sleep_completed: false, // Trying to uncheck
      exercise_completed: false,
      sunlight_completed: false,
      diet_completed: false,
      alcohol_avoided: false,
      no_porn_masturbation: false
    };

    try {
      const uncheckResponse = await axios.post(`${API_URL}/daily-missions`, {
        date: today,
        missions: uncheckData
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('❌ Mission was unchecked (this should not happen)');
      console.log('Response:', uncheckResponse.data);
    } catch (error) {
      console.log('✅ Mission unchecking was prevented (expected behavior)');
    }

    // Verify the mission is still completed
    console.log('\n4. Verifying mission is still completed...');
    const verifyResponse = await axios.get(`${API_URL}/daily-missions/today`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('Current mission state:', verifyResponse.data);
    
    if (verifyResponse.data && verifyResponse.data.sleep_completed) {
      console.log('✅ Mission remains completed (correct behavior)');
    } else {
      console.log('❌ Mission was unchecked (incorrect behavior)');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testMissionUnchecking(); 