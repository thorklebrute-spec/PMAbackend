import axios from 'axios';

const API_URL = 'http://192.168.0.232:3000';

// Debug progress saving issue
async function debugProgressIssue() {
  try {
    console.log('🔍 Debugging Progress Saving Issue...\n');

    // First, authenticate
    console.log('1. Authenticating...');
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

    // Set up API client
    const api = axios.create({
      baseURL: API_URL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Check current daily missions
    console.log('\n2. Checking current daily missions...');
    const todayMissionsResponse = await api.get('/daily-missions/today');
    console.log('Today\'s missions:', todayMissionsResponse.data);

    // Check current progress
    console.log('\n3. Checking current progress...');
    const progressResponse = await api.get('/progress');
    console.log('Current progress entries:', progressResponse.data.length);
    if (progressResponse.data.length > 0) {
      console.log('Latest progress:', progressResponse.data[0]);
    }

    // Check onboarding data
    console.log('\n4. Checking onboarding data...');
    const onboardingResponse = await api.get('/user/onboarding');
    console.log('Onboarding data:', onboardingResponse.data);

    // Test completing all missions
    console.log('\n5. Testing completion of all missions...');
    const today = new Date().toISOString().split('T')[0];
    const allMissionsCompleted = {
      sleep_completed: true,
      exercise_completed: true,
      sunlight_completed: true,
      diet_completed: true,
      alcohol_avoided: true,
      no_porn_masturbation: true
    };

    const missionResponse = await api.post('/daily-missions', {
      date: today,
      missions: allMissionsCompleted
    });
    console.log('✅ Missions saved successfully');

    // Check if progress was automatically saved
    console.log('\n6. Checking if progress was automatically saved...');
    const newProgressResponse = await api.get('/progress');
    console.log('Progress entries after mission completion:', newProgressResponse.data.length);
    if (newProgressResponse.data.length > 0) {
      console.log('Latest progress after completion:', newProgressResponse.data[0]);
    }

    // Manually test the check-progress endpoint
    console.log('\n7. Manually testing check-progress endpoint...');
    if (onboardingResponse.data.data) {
      const checkProgressResponse = await api.post('/daily-missions/check-progress', {
        date: today,
        missions: allMissionsCompleted,
        onboardingData: onboardingResponse.data.data
      });
      console.log('Check progress response:', checkProgressResponse.data);
    } else {
      console.log('⚠️  No onboarding data found, cannot test check-progress');
    }

    // Check final state
    console.log('\n8. Final state check...');
    const finalMissionsResponse = await api.get('/daily-missions/today');
    const finalProgressResponse = await api.get('/progress');
    
    console.log('Final missions state:', finalMissionsResponse.data);
    console.log('Final progress entries:', finalProgressResponse.data.length);

    console.log('\n🎯 Debug Summary:');
    console.log('- Missions completed and saved:', finalMissionsResponse.data ? '✅' : '❌');
    console.log('- Progress automatically saved:', finalProgressResponse.data.length > 0 ? '✅' : '❌');
    console.log('- Onboarding data available:', onboardingResponse.data.data ? '✅' : '❌');

  } catch (error) {
    console.error('❌ Debug failed:', error.response?.data || error.message);
  }
}

debugProgressIssue(); 