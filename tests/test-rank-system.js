import { supabaseAdmin } from './supabaseClient.js';
import { processDailyRankUpdate, getUserRank, getLeaderboard } from './rankSystem.js';

// Test script to demonstrate the rank system
const testRankSystem = async () => {
  try {
    console.log('🏆 Testing Rank System...');
    
    // Replace with an actual user ID from your database
    const testUserId = 'your-test-user-id-here';
    
    if (testUserId === 'your-test-user-id-here') {
      console.log('❌ Please replace testUserId with an actual user ID from your database');
      console.log('💡 You can get a user ID by running:');
      console.log('   SELECT id FROM auth.users LIMIT 1;');
      return;
    }
    
    console.log('👤 Testing with user ID:', testUserId);
    
    // 1. Get current user rank
    console.log('\n📊 Current User Rank:');
    const currentRank = await getUserRank(testUserId);
    console.log('Current Rank:', currentRank);
    
    // 2. Simulate completing missions for today
    const today = new Date().toISOString().split('T')[0];
    const sampleMissions = {
      sleep_completed: true,
      exercise_completed: true,
      sunlight_completed: true,
      diet_completed: true,
      alcohol_avoided: true,
      cold_exposure_completed: true,
      no_porn_masturbation: true
    };
    
    console.log('\n🎯 Simulating perfect day (all 7 missions completed):');
    console.log('Missions:', sampleMissions);
    
    // 3. Process rank update
    console.log('\n🔄 Processing rank update...');
    const rankUpdate = await processDailyRankUpdate(testUserId, today, sampleMissions, 85);
    
    console.log('✅ Rank update completed:');
    console.log('- Points earned today:', rankUpdate.pointsEarned);
    console.log('- New total points:', rankUpdate.newTotalPoints);
    console.log('- New rank:', rankUpdate.rankInfo.name);
    console.log('- Points to next rank:', rankUpdate.rank.points_to_next_rank);
    
    // 4. Get updated rank
    console.log('\n📈 Updated User Rank:');
    const updatedRank = await getUserRank(testUserId);
    console.log('Updated Rank:', updatedRank);
    
    // 5. Show leaderboard
    console.log('\n🏅 Leaderboard (Top 5):');
    const leaderboard = await getLeaderboard(5);
    leaderboard.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.displayName} - ${entry.currentRank} (${entry.totalPoints} pts)`);
    });
    
    // 6. Show daily points breakdown
    console.log('\n📋 Daily Points Breakdown:');
    const { data: dailyPoints } = await supabaseAdmin
      .from('daily_points')
      .select('*')
      .eq('user_id', testUserId)
      .eq('date', today)
      .single();
    
    if (dailyPoints) {
      console.log('- Mission points:', dailyPoints.mission_points);
      console.log('- Streak bonus:', dailyPoints.streak_bonus);
      console.log('- Progress points:', dailyPoints.progress_points);
      console.log('- Lifestyle bonus:', dailyPoints.lifestyle_bonus);
      console.log('- Total points:', dailyPoints.total_points);
      console.log('- Streak days:', dailyPoints.streak_days);
    }
    
    console.log('\n🎉 Rank system test completed successfully!');
    
  } catch (error) {
    console.error('❌ Rank system test failed:', error);
  }
};

// Test different scenarios
const testDifferentScenarios = async () => {
  try {
    console.log('\n🧪 Testing Different Scenarios...');
    
    const testUserId = 'your-test-user-id-here';
    if (testUserId === 'your-test-user-id-here') {
      console.log('❌ Please set a valid user ID');
      return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    // Scenario 1: Partial completion (4/7 missions)
    console.log('\n📊 Scenario 1: Partial completion (4/7 missions)');
    const partialMissions = {
      sleep_completed: true,
      exercise_completed: true,
      sunlight_completed: false,
      diet_completed: true,
      alcohol_avoided: false,
      cold_exposure_completed: true,
      no_porn_masturbation: false
    };
    
    await processDailyRankUpdate(testUserId, today, partialMissions, 70);
    
    // Scenario 2: Perfect day with high lifestyle score
    console.log('\n📊 Scenario 2: Perfect day with high lifestyle score');
    const perfectMissions = {
      sleep_completed: true,
      exercise_completed: true,
      sunlight_completed: true,
      diet_completed: true,
      alcohol_avoided: true,
      cold_exposure_completed: true,
      no_porn_masturbation: true
    };
    
    await processDailyRankUpdate(testUserId, today, perfectMissions, 90);
    
    // Scenario 3: Minimal completion (2/7 missions)
    console.log('\n📊 Scenario 3: Minimal completion (2/7 missions)');
    const minimalMissions = {
      sleep_completed: true,
      exercise_completed: false,
      sunlight_completed: false,
      diet_completed: false,
      alcohol_avoided: true,
      cold_exposure_completed: false,
      no_porn_masturbation: false
    };
    
    await processDailyRankUpdate(testUserId, today, minimalMissions, 60);
    
    console.log('\n✅ All scenarios tested!');
    
  } catch (error) {
    console.error('❌ Scenario testing failed:', error);
  }
};

// Run the tests
testRankSystem();
// testDifferentScenarios(); // Uncomment to test different scenarios 