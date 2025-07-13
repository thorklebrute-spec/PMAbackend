import { supabaseAdmin } from './supabaseClient.js';

// Cap daily improvements for each metric
const MAX_DAILY_IMPROVEMENTS = {
  testosterone: 10, // ng/dL per day
  spermCount: 2,    // million/mL per day
  strength: 2       // kg per day
};

// Calculate daily progress improvements based on completed missions
const calculateDailyProgressImprovements = (onboardingData, completedMissions) => {
  const improvements = {
    testosterone: 0,
    spermCount: 0,
    strength: 0
  };

  // Base improvements for each completed mission
  const missionImprovements = {
    sleep_completed: { testosterone: 15, spermCount: 2, strength: 3 },
    exercise_completed: { testosterone: 25, spermCount: 3, strength: 8 },
    sunlight_completed: { testosterone: 10, spermCount: 1, strength: 2 },
    diet_completed: { testosterone: 20, spermCount: 4, strength: 5 },
    alcohol_avoided: { testosterone: 15, spermCount: 2, strength: 3 },
    cold_exposure_completed: { testosterone: 12, spermCount: 2, strength: 4 },
    no_porn_masturbation: { testosterone: 20, spermCount: 5, strength: 2 }
  };

  // Calculate total improvements
  Object.keys(completedMissions).forEach(missionKey => {
    if (completedMissions[missionKey] && missionImprovements[missionKey]) {
      improvements.testosterone += missionImprovements[missionKey].testosterone;
      improvements.spermCount += missionImprovements[missionKey].spermCount;
      improvements.strength += missionImprovements[missionKey].strength;
    }
  });

  // Apply age-based multipliers
  const ageMultiplier = onboardingData.age < 30 ? 1.2 : onboardingData.age < 50 ? 1.0 : 0.8;
  
  improvements.testosterone = Math.round(improvements.testosterone * ageMultiplier);
  improvements.spermCount = Math.round(improvements.spermCount * ageMultiplier);
  improvements.strength = Math.round(improvements.strength * ageMultiplier);

  // Cap the improvements to realistic daily maximums
  improvements.testosterone = Math.min(improvements.testosterone, MAX_DAILY_IMPROVEMENTS.testosterone);
  improvements.spermCount = Math.min(improvements.spermCount, MAX_DAILY_IMPROVEMENTS.spermCount);
  improvements.strength = Math.min(improvements.strength, MAX_DAILY_IMPROVEMENTS.strength);

  return improvements;
};

// Calculate base health metrics from onboarding data
const calculateBaseHealthMetrics = (onboardingData) => {
  // Base testosterone by age (ng/dL)
  let baseTestosterone = 0;
  if (onboardingData.age < 20) baseTestosterone = 650;
  else if (onboardingData.age < 30) baseTestosterone = 600;
  else if (onboardingData.age < 40) baseTestosterone = 550;
  else if (onboardingData.age < 50) baseTestosterone = 500;
  else if (onboardingData.age < 60) baseTestosterone = 450;
  else if (onboardingData.age < 70) baseTestosterone = 400;
  else baseTestosterone = 350;

  // Base strength by age (kg)
  let baseStrength = 0;
  if (onboardingData.age < 20) baseStrength = 60;
  else if (onboardingData.age < 30) baseStrength = 70;
  else if (onboardingData.age < 40) baseStrength = 75;
  else if (onboardingData.age < 50) baseStrength = 70;
  else if (onboardingData.age < 60) baseStrength = 65;
  else if (onboardingData.age < 70) baseStrength = 55;
  else baseStrength = 45;

  // Sperm count (use actual or estimated)
  const spermCount = onboardingData.hadTest ? onboardingData.spermCount : 
    (onboardingData.age < 20 ? 70 : onboardingData.age < 30 ? 65 : onboardingData.age < 40 ? 55 : 
     onboardingData.age < 50 ? 50 : onboardingData.age < 60 ? 40 : onboardingData.age < 70 ? 30 : 25);

  return {
    testosterone: baseTestosterone,
    spermCount: spermCount,
    strength: baseStrength
  };
};

// Check if all missions are completed and save progress
export const checkAndSaveDailyProgress = async (userId, date, missions, onboardingData) => {
  try {
    console.log('🔍 checkAndSaveDailyProgress called with:');
    console.log('- User ID:', userId);
    console.log('- Date:', date);
    console.log('- Missions:', missions);
    console.log('- Onboarding data available:', !!onboardingData);
    
    // Check if all missions are completed
    const requiredMissions = ['sleep_completed', 'exercise_completed', 'sunlight_completed', 'diet_completed', 'alcohol_avoided', 'cold_exposure_completed', 'no_porn_masturbation'];
    const allCompleted = requiredMissions.every(mission => missions[mission] === true);

    console.log('Required missions:', requiredMissions);
    console.log('Mission completion status:', requiredMissions.map(mission => `${mission}: ${missions[mission]}`));
    console.log('All completed:', allCompleted);

    if (!allCompleted) {
      console.log('❌ Not all missions completed yet');
      return { success: false, message: 'Not all missions completed' };
    }

    // Calculate base metrics
    const baseMetrics = calculateBaseHealthMetrics(onboardingData);
    
    // Calculate daily improvements
    const improvements = calculateDailyProgressImprovements(onboardingData, missions);
    
    // Calculate final metrics for the day
    const finalMetrics = {
      testosterone: baseMetrics.testosterone + improvements.testosterone,
      spermCount: baseMetrics.spermCount + improvements.spermCount,
      strength: baseMetrics.strength + improvements.strength
    };

    // Format health data for storage
    const healthData = [
      {
        icon: 'flash',
        label: 'Testosterone',
        value: finalMetrics.testosterone.toString(),
        color: '#c0392b',
      },
      {
        icon: 'flask',
        label: 'Sperm Count',
        value: finalMetrics.spermCount.toString(),
        color: '#2980b9',
      },
      {
        icon: 'barbell-outline',
        label: 'Strength',
        value: finalMetrics.strength.toString(),
        color: '#2c3e50',
      },
    ];

    // Save progress to database
    const result = await saveUserProgress(userId, date, healthData);

    console.log('Daily progress saved successfully:', {
      date,
      baseMetrics,
      improvements,
      finalMetrics
    });

    return {
      success: true,
      data: result,
      metrics: finalMetrics,
      improvements: improvements
    };

  } catch (error) {
    console.error('Error checking and saving daily progress:', error);
    throw error;
  }
};

// Get user's progress data for the last 7 days
export const getUserProgress = async (userId) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabaseAdmin
      .from('progress')
      .select('*')
      .eq('user_id', userId)
      .gte('date', sevenDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching user progress:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error in getUserProgress:', error);
    throw error;
  }
};

// Save or update user's progress data for a specific date
export const saveUserProgress = async (userId, date, healthData) => {
  try {
    console.log('💾 Saving user progress to database...');
    console.log('- User ID:', userId);
    console.log('- Date:', date);
    console.log('- Health data:', healthData);
    
    const { data, error } = await supabaseAdmin
      .from('progress')
      .upsert([
        {
          user_id: userId,
          date: date,
          health_data: healthData,
          updated_at: new Date().toISOString()
        }
      ], {
        onConflict: 'user_id,date'
      })
      .select();

    if (error) {
      console.error('❌ Error saving user progress:', error);
      throw error;
    }

    console.log('✅ Progress saved successfully:', data[0]);
    return data[0];
  } catch (error) {
    console.error('❌ Error in saveUserProgress:', error);
    throw error;
  }
};

// Get user's progress statistics for chart view
export const getProgressStats = async (userId) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await supabaseAdmin
      .from('progress')
      .select('*')
      .eq('user_id', userId)
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (error) {
      console.error('Error fetching progress stats:', error);
      throw error;
    }

    // Process data for charts
    const chartData = {
      testosterone: [],
      spermCount: [],
      strength: [],
      dates: []
    };

    data.forEach(entry => {
      const healthData = entry.health_data;
      chartData.dates.push(entry.date);
      
      // Extract values from health_data JSON
      const testosteroneEntry = healthData.find(item => item.label === 'Testosterone');
      const spermCountEntry = healthData.find(item => item.label === 'Sperm Count');
      const strengthEntry = healthData.find(item => item.label === 'Strength');

      chartData.testosterone.push(testosteroneEntry ? parseFloat(testosteroneEntry.value) : 0);
      chartData.spermCount.push(spermCountEntry ? parseFloat(spermCountEntry.value) : 0);
      chartData.strength.push(strengthEntry ? parseFloat(strengthEntry.value) : 0);
    });

    return chartData;
  } catch (error) {
    console.error('Error in getProgressStats:', error);
    throw error;
  }
};

// Get today's progress data
export const getTodayProgress = async (userId) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('progress')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
      console.error('Error fetching today\'s progress:', error);
      throw error;
    }

    return data || null;
  } catch (error) {
    console.error('Error in getTodayProgress:', error);
    throw error;
  }
};

// Populate progress table with last 7 days of data based on daily missions
export const populateProgressFromMissions = async (userId) => {
  try {
    console.log('🔄 Starting progress population for user:', userId);
    
    // Get user's onboarding data
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('onboarding_data')
      .eq('id', userId)
      .single();

    if (profileError || !profileData?.onboarding_data) {
      console.log('❌ No onboarding data found for user, cannot populate progress');
      return { 
        success: false, 
        message: 'No onboarding data found. Please complete onboarding first.' 
      };
    }

    const onboardingData = profileData.onboarding_data;
    console.log('✅ Onboarding data found for progress calculation');

    // Calculate date range for last 7 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6); // 7 days including today
    
    console.log('📅 Date range:', { 
      startDate: startDate.toISOString().split('T')[0], 
      endDate: endDate.toISOString().split('T')[0] 
    });

    // Fetch daily missions for the last 7 days
    const { data: missionsData, error: missionsError } = await supabaseAdmin
      .from('daily_missions')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (missionsError) {
      console.error('❌ Error fetching daily missions:', missionsError);
      throw new Error('Failed to fetch daily missions');
    }

    console.log(`📊 Found ${missionsData?.length || 0} days of mission data`);

    if (!missionsData || missionsData.length === 0) {
      return { 
        success: false, 
        message: 'No daily missions found for the last 7 days' 
      };
    }

    // Calculate base metrics once
    const baseMetrics = calculateBaseHealthMetrics(onboardingData);
    console.log('📈 Base metrics calculated:', baseMetrics);

    // Process each day's missions and calculate progress
    const progressEntries = [];
    let populatedCount = 0;
    let skippedCount = 0;

    for (const missionRecord of missionsData) {
      const date = missionRecord.date;
      
      // Check if progress already exists for this date
      const { data: existingProgress } = await supabaseAdmin
        .from('progress')
        .select('id')
        .eq('user_id', userId)
        .eq('date', date)
        .single();

      if (existingProgress) {
        console.log(`⏭️  Progress already exists for ${date}, skipping`);
        skippedCount++;
        continue;
      }

      // Calculate improvements based on completed missions
      const improvements = calculateDailyProgressImprovements(onboardingData, {
        sleep_completed: missionRecord.sleep_completed,
        exercise_completed: missionRecord.exercise_completed,
        sunlight_completed: missionRecord.sunlight_completed,
        diet_completed: missionRecord.diet_completed,
        alcohol_avoided: missionRecord.alcohol_avoided,
        cold_exposure_completed: missionRecord.cold_exposure_completed,
        no_porn_masturbation: missionRecord.no_porn_masturbation
      });

      // Calculate final metrics for the day
      const finalMetrics = {
        testosterone: baseMetrics.testosterone + improvements.testosterone,
        spermCount: baseMetrics.spermCount + improvements.spermCount,
        strength: baseMetrics.strength + improvements.strength
      };

      // Format health data for storage
      const healthData = [
        {
          icon: 'flash',
          label: 'Testosterone',
          value: finalMetrics.testosterone.toString(),
          color: '#c0392b',
        },
        {
          icon: 'flask',
          label: 'Sperm Count',
          value: finalMetrics.spermCount.toString(),
          color: '#2980b9',
        },
        {
          icon: 'barbell-outline',
          label: 'Strength',
          value: finalMetrics.strength.toString(),
          color: '#2c3e50',
        },
      ];

      progressEntries.push({
        user_id: userId,
        date: date,
        health_data: healthData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      console.log(`📝 Prepared progress for ${date}:`, {
        completedMissions: Object.values({
          sleep: missionRecord.sleep_completed,
          exercise: missionRecord.exercise_completed,
          sunlight: missionRecord.sunlight_completed,
          diet: missionRecord.diet_completed,
          alcohol: missionRecord.alcohol_avoided,
          cold_exposure: missionRecord.cold_exposure_completed,
          no_porn_masturbation: missionRecord.no_porn_masturbation
        }).filter(Boolean).length,
        improvements,
        finalMetrics
      });
    }

    // Save all progress entries to database
    if (progressEntries.length > 0) {
      const { data: savedProgress, error: saveError } = await supabaseAdmin
        .from('progress')
        .insert(progressEntries)
        .select();

      if (saveError) {
        console.error('❌ Error saving progress entries:', saveError);
        throw new Error('Failed to save progress entries');
      }

      populatedCount = savedProgress.length;
      console.log(`✅ Successfully saved ${populatedCount} progress entries`);
    }

    console.log('🎉 Progress population completed:', {
      totalDays: missionsData.length,
      populated: populatedCount,
      skipped: skippedCount
    });

    return {
      success: true,
      message: `Progress populated successfully. ${populatedCount} new entries created, ${skippedCount} existing entries skipped.`,
      stats: {
        totalDays: missionsData.length,
        populated: populatedCount,
        skipped: skippedCount
      }
    };

  } catch (error) {
    console.error('❌ Error populating progress from missions:', error);
    throw error;
  }
}; 

// Note: The daily points cap (max 50) is enforced in rankSystem.js/calculateDailyPoints 