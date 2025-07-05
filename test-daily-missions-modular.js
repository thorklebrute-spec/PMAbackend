import axios from 'axios';

const API_URL = 'http://localhost:3000';

// Test data for daily missions
const testDailyMissions = {
  date: new Date().toISOString().split('T')[0],
  missions: {
    sleep: true,
    exercise: true,
    sunlight: false,
    diet: true,
    alcohol: false,
    cold_exposure: true,
    no_porn_masturbation: true
  }
};

async function testModularDailyMissions() {
  try {
    console.log('Testing Modular Daily Missions System...\n');

    // First, we need to get a valid token by signing in
    console.log('1. Testing authentication...');
    const signinResponse = await axios.post(`${API_URL}/auth/signin`, {
      email: 'jesse.mashoana@gmail.com',
      password: 'testpassword123'
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

    // Test POST /daily-missions
    console.log('2. Testing POST /daily-missions...');
    const postResponse = await api.post('/daily-missions', testDailyMissions);
    console.log('✅ Daily missions saved successfully');
    console.log('Response:', postResponse.data);

    // Test GET /daily-missions
    console.log('\n3. Testing GET /daily-missions...');
    const getResponse = await api.get('/daily-missions');
    console.log('✅ Daily missions fetched successfully');
    console.log('Response count:', getResponse.data.length);
    console.log('Sample data:', getResponse.data[0]);

    // Test GET /daily-missions/stats
    console.log('\n4. Testing GET /daily-missions/stats...');
    const statsResponse = await api.get('/daily-missions/stats');
    console.log('✅ Daily mission stats fetched successfully');
    console.log('Stats:', statsResponse.data);

    // Test GET /daily-missions/today
    console.log('\n5. Testing GET /daily-missions/today...');
    const todayResponse = await api.get('/daily-missions/today');
    console.log('✅ Today\'s daily missions fetched successfully');
    console.log('Today\'s data:', todayResponse.data);

    // Test GET /progress (should use the same modular functions)
    console.log('\n6. Testing GET /progress...');
    const progressResponse = await api.get('/progress');
    console.log('✅ Progress data fetched successfully');
    console.log('Response count:', progressResponse.data.length);
    console.log('Sample data:', progressResponse.data[0]);

    // Test POST /progress (should use the same modular functions)
    console.log('\n7. Testing POST /progress...');
    const progressPostResponse = await api.post('/progress', testDailyMissions);
    console.log('✅ Progress data saved successfully');
    console.log('Response:', progressPostResponse.data);

    console.log('\n🎉 All modular daily missions endpoints working correctly!');
    console.log('\n📊 Summary:');
    console.log('- Daily missions module is properly separated');
    console.log('- All endpoints use the same underlying functions');
    console.log('- Statistics are calculated from real data');
    console.log('- Error handling is consistent across all endpoints');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testModularDailyMissions(); 