import { supabaseAdmin } from './supabaseClient.js';

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
    alcohol_avoided: { testosterone: 15, spermCount: 2, strength: 3 }
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
    // Check if all missions are completed
    const requiredMissions = ['sleep_completed', 'exercise_completed', 'sunlight_completed', 'diet_completed', 'alcohol_avoided'];
    const allCompleted = requiredMissions.every(mission => missions[mission] === true);

    if (!allCompleted) {
      console.log('Not all missions completed yet');
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
      console.error('Error saving user progress:', error);
      throw error;
    }

    return data[0];
  } catch (error) {
    console.error('Error in saveUserProgress:', error);
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