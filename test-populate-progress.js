import { supabaseAdmin } from './supabaseClient.js';
import { populateProgressFromMissions } from './progress.js';

// Test script to populate progress from daily missions
const testPopulateProgress = async () => {
  try {
    console.log('🧪 Testing progress population from daily missions...');
    
    // Replace with an actual user ID from your database
    const testUserId = 'your-test-user-id-here';
    
    if (testUserId === 'your-test-user-id-here') {
      console.log('❌ Please replace testUserId with an actual user ID from your database');
      console.log('💡 You can get a user ID by running:');
      console.log('   SELECT id FROM auth.users LIMIT 1;');
      return;
    }
    
    console.log('👤 Testing with user ID:', testUserId);
    
    // Check if user has onboarding data
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('onboarding_data')
      .eq('id', testUserId)
      .single();

    if (profileError || !profileData?.onboarding_data) {
      console.log('❌ User does not have onboarding data');
      console.log('💡 Complete onboarding first to populate progress');
      return;
    }

    console.log('✅ User has onboarding data');

    // Check if user has daily missions
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    
    const { data: missionsData, error: missionsError } = await supabaseAdmin
      .from('daily_missions')
      .select('*')
      .eq('user_id', testUserId)
      .gte('date', sevenDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (missionsError) {
      console.error('❌ Error fetching missions:', missionsError);
      return;
    }

    console.log(`📊 Found ${missionsData?.length || 0} days of mission data`);
    
    if (!missionsData || missionsData.length === 0) {
      console.log('❌ No daily missions found for the last 7 days');
      console.log('💡 Complete some daily missions first');
      return;
    }

    // Show mission data
    console.log('\n📋 Mission data for the last 7 days:');
    missionsData.forEach(mission => {
      const completedCount = Object.values({
        sleep: mission.sleep_completed,
        exercise: mission.exercise_completed,
        sunlight: mission.sunlight_completed,
        diet: mission.diet_completed,
        alcohol: mission.alcohol_avoided,
        cold_exposure: mission.cold_exposure_completed,
        no_porn_masturbation: mission.no_porn_masturbation
      }).filter(Boolean).length;
      
      console.log(`  ${mission.date}: ${completedCount}/7 missions completed`);
    });

    // Check existing progress
    const { data: existingProgress, error: progressError } = await supabaseAdmin
      .from('progress')
      .select('date')
      .eq('user_id', testUserId)
      .gte('date', sevenDaysAgo.toISOString().split('T')[0]);

    if (progressError) {
      console.error('❌ Error checking existing progress:', progressError);
      return;
    }

    console.log(`\n📈 Found ${existingProgress?.length || 0} existing progress entries`);

    // Populate progress
    console.log('\n🔄 Populating progress from missions...');
    const result = await populateProgressFromMissions(testUserId);
    
    if (result.success) {
      console.log('✅ Progress population successful!');
      console.log('📊 Stats:', result.stats);
      console.log('💬 Message:', result.message);
      
      // Show the new progress data
      const { data: newProgress, error: newProgressError } = await supabaseAdmin
        .from('progress')
        .select('*')
        .eq('user_id', testUserId)
        .gte('date', sevenDaysAgo.toISOString().split('T')[0])
        .order('date', { ascending: false });

      if (!newProgressError && newProgress) {
        console.log('\n📊 New progress data:');
        newProgress.forEach(progress => {
          const healthData = progress.health_data;
          console.log(`  ${progress.date}:`);
          healthData.forEach(metric => {
            console.log(`    ${metric.label}: ${metric.value} ${metric.label === 'Testosterone' ? 'ng/dL' : metric.label === 'Sperm Count' ? 'm/mL' : 'Kg'}`);
          });
        });
      }
    } else {
      console.log('❌ Progress population failed:', result.message);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
};

// Run the test
testPopulateProgress(); 