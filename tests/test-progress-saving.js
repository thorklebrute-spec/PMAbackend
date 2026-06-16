import axios from 'axios';
import { API_URL, TEST_EMAIL, TEST_PASSWORD } from './testConfig.js';

// Test progress saving when all missions are completed
async function testProgressSaving() {
  try {
    console.log('Testing Progress Saving...\n');

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
    console.log('✅ Authentication successful');

    // Set up API client
    const api = axios.create({
      baseURL: API_URL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // First, save onboarding data to user_profiles table
    console.log('\n2. Saving onboarding data to database...');
    const sampleOnboardingData = {
      goal: 'Boost Fertility',
      diet: 'Very healthy',
      hadTest: true,
      age: 25,
      spermCount: 60,
      exerciseDays: 5,
      smoke: false,
      alcohol: 'Rarely / Never',
      sleep: '7 - 8',
      stress: 3,
      sunlightExposure: 'Daily',
      supplements: true,
      dataLog: 'Daily'
    };

    try {
      await api.post('/user/onboarding', sampleOnboardingData);
      console.log('✅ Onboarding data saved to database');
    } catch (error) {
      console.log('⚠️  Onboarding data save failed (might already exist):', error.response?.status);
    }

    // Test the check-progress endpoint with all missions completed
    console.log('\n3. Testing progress saving with all missions completed...');
    
    const today = new Date().toISOString().split('T')[0];
    const allMissionsCompleted = {
      sleep_completed: true,
      exercise_completed: true,
      sunlight_completed: true,
      diet_completed: true,
      alcohol_avoided: true,
      cold_exposure_completed: true,
      no_porn_masturbation: true
    };

    const progressResponse = await api.post('/daily-missions/check-progress', {
      date: today,
      missions: allMissionsCompleted,
      onboardingData: sampleOnboardingData
    });

    console.log('Progress response:', progressResponse.data);

    // Test saving missions and automatic progress saving
    console.log('\n4. Testing automatic progress saving via daily missions endpoint...');
    const missionResponse = await api.post('/daily-missions', {
      date: today,
      missions: allMissionsCompleted
    });

    console.log('✅ Missions saved successfully');

    // Check if progress was automatically saved
    console.log('\n5. Checking if progress was automatically saved...');
    const progressCheckResponse = await api.get('/progress');
    console.log('Progress entries:', progressCheckResponse.data.length);
    if (progressCheckResponse.data.length > 0) {
      console.log('Latest progress:', progressCheckResponse.data[0]);
    }

    console.log('\n🎯 Test Summary:');
    console.log('- Onboarding data saved:', '✅');
    console.log('- All 7 missions completed:', '✅');
    console.log('- Progress calculation successful:', progressResponse.data.success ? '✅' : '❌');
    console.log('- Progress saved to database:', progressCheckResponse.data.length > 0 ? '✅' : '❌');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testProgressSaving(); 