import { supabaseAdmin } from './supabaseClient.js';

// Get user's daily missions for the last 7 days
export const getDailyMissions = async (userId) => {
  try {
    console.log('Fetching daily missions for user:', userId);
    
    // Calculate date range for last 7 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6); // 7 days including today
    
    console.log('Date range:', { startDate: startDate.toISOString(), endDate: endDate.toISOString() });
    
    const { data, error } = await supabaseAdmin
      .from('daily_missions')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching daily missions:', error);
      throw new Error('Failed to fetch daily missions');
    }

    console.log('Daily missions fetched:', { count: data?.length || 0 });
    
    // Format the data to match the frontend structure
    const formattedData = data?.map(record => formatDailyMissionRecord(record)) || [];

    return formattedData;
  } catch (error) {
    console.error('Error fetching daily missions:', error);
    throw error;
  }
};

// Add or update user's daily missions for a specific date
export const saveDailyMissions = async (userId, date, missions) => {
  try {
    if (!date || !missions) {
      throw new Error('Date and missions data are required');
    }

    console.log('Adding/updating daily missions for user:', userId, 'date:', date);
    console.log('Missions data received:', missions);
    
    // Prepare mission data - only include the mission fields, not user_id or date
    const missionData = {
      user_id: userId,
      date: date,
      sleep_completed: missions.sleep_completed || false,
      exercise_completed: missions.exercise_completed || false,
      sunlight_completed: missions.sunlight_completed || false,
      diet_completed: missions.diet_completed || false,
      alcohol_avoided: missions.alcohol_avoided || false,
      cold_exposure_completed: missions.cold_exposure_completed || false,
      no_porn_masturbation: missions.no_porn_masturbation || false
    };
    
    console.log('Prepared mission data:', missionData);
    
    // Use upsert to insert or update
    const { data, error } = await supabaseAdmin
      .from('daily_missions')
      .upsert([missionData], {
        onConflict: 'user_id,date'
      })
      .select();

    if (error) {
      console.error('Error saving daily missions:', error);
      throw new Error('Failed to save daily missions');
    }

    console.log('Daily missions saved successfully:', data[0]);
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error saving daily missions:', error);
    throw error;
  }
};

// Format a single daily mission record for frontend consumption
export const formatDailyMissionRecord = (record) => {
  const completedMissions = [
    record.sleep_completed && { icon: 'bed-outline', label: 'Sleep (+7 hours)', value: 'Completed', color: '#388E3C' },
    record.exercise_completed && { icon: 'barbell-outline', label: 'Worked out', value: 'Completed', color: '#388E3C' },
    record.sunlight_completed && { icon: 'sunny-outline', label: 'Sunlight exposure', value: 'Completed', color: '#388E3C' },
    record.diet_completed && { icon: 'fast-food-outline', label: 'Fertility-boosting diet', value: 'Completed', color: '#388E3C' },
    record.alcohol_avoided && { icon: 'wine-outline', label: 'No alcohol', value: 'Completed', color: '#388E3C' },
    record.cold_exposure_completed && { icon: 'snow-outline', label: 'Cold Exposure', value: 'Completed', color: '#388E3C' },
    record.no_porn_masturbation && { icon: 'radio-button-on-outline', label: 'No FAP', value: 'Completed', color: '#388E3C' }
  ].filter(Boolean);

  const incompleteMissions = [
    !record.sleep_completed && { icon: 'bed-outline', label: 'Sleep (+7 hours)', value: 'Not Done', color: '#e74c3c' },
    !record.exercise_completed && { icon: 'barbell-outline', label: 'Worked out', value: 'Not Done', color: '#e74c3c' },
    !record.sunlight_completed && { icon: 'sunny-outline', label: 'Sunlight exposure', value: 'Not Done', color: '#e74c3c' },
    !record.diet_completed && { icon: 'fast-food-outline', label: 'Fertility-boosting diet', value: 'Not Done', color: '#e74c3c' },
    !record.alcohol_avoided && { icon: 'wine-outline', label: 'No alcohol', value: 'Not Done', color: '#e74c3c' },
    !record.cold_exposure_completed && { icon: 'snow-outline', label: 'Cold Exposure', value: 'Not Done', color: '#e74c3c' },
    !record.no_porn_masturbation && { icon: 'radio-button-on-outline', label: 'No FAP', value: 'Not Done', color: '#e74c3c' }
  ].filter(Boolean);

  return {
    date: new Date(record.date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }),
    healthData: [...completedMissions, ...incompleteMissions],
    completedCount: completedMissions.length,
    totalCount: 7
  };
};

// Get daily mission statistics for chart view
export const getDailyMissionStats = async (userId) => {
  try {
    // Calculate date range for last 30 days to get better statistics
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 29); // 30 days including today
    
    const { data, error } = await supabaseAdmin
      .from('daily_missions')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    if (error) {
      console.error('Error fetching daily mission stats:', error);
      throw new Error('Failed to fetch daily mission stats');
    }

    // Calculate completion rates for each mission type
    const totalDays = data.length || 1;
    const stats = {
      sleep: Math.round((data.filter(record => record.sleep_completed).length / totalDays) * 100),
      exercise: Math.round((data.filter(record => record.exercise_completed).length / totalDays) * 100),
      sunlight: Math.round((data.filter(record => record.sunlight_completed).length / totalDays) * 100),
      diet: Math.round((data.filter(record => record.diet_completed).length / totalDays) * 100),
      alcohol: Math.round((data.filter(record => record.alcohol_avoided).length / totalDays) * 100),
      cold_exposure: Math.round((data.filter(record => record.cold_exposure_completed).length / totalDays) * 100),
      no_porn_masturbation: Math.round((data.filter(record => record.no_porn_masturbation).length / totalDays) * 100)
    };

    return stats;
  } catch (error) {
    console.error('Error calculating daily mission stats:', error);
    throw error;
  }
};

// Get today's daily missions
export const getTodayDailyMissions = async (userId) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabaseAdmin
      .from('daily_missions')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found" error
      console.error('Error fetching today\'s daily missions:', error);
      throw new Error('Failed to fetch today\'s daily missions');
    }

    return data || null;
  } catch (error) {
    console.error('Error fetching today\'s daily missions:', error);
    throw error;
  }
};

// Check if all missions are completed for a specific date
export const checkMissionsCompleted = async (userId, date) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('daily_missions')
      .select('sleep_completed, exercise_completed, sunlight_completed, diet_completed, alcohol_avoided, cold_exposure_completed, no_porn_masturbation')
      .eq('user_id', userId)
      .eq('date', date)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking missions completion:', error);
      throw new Error('Failed to check missions completion');
    }

    if (!data) {
      return false; // No missions recorded for this date
    }

    // Check if all required missions are completed (including the new No FAP mission)
    const requiredMissions = ['sleep_completed', 'exercise_completed', 'sunlight_completed', 'diet_completed', 'alcohol_avoided', 'cold_exposure_completed', 'no_porn_masturbation'];
    const allCompleted = requiredMissions.every(mission => data[mission] === true);

    return allCompleted;
  } catch (error) {
    console.error('Error checking missions completion:', error);
    throw error;
  }
}; 