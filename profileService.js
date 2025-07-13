import { supabaseAdmin } from './supabaseClient.js';

/**
 * Get user profile data
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} Profile data
 */
export const getUserProfile = async (userId) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user profile:', error);
      throw error;
    }

    return profile || {
      id: userId,
      onboarding_data: null,
      profile_picture_url: null,
      bio: null,
      display_name: null,
      created_at: null,
      updated_at: null
    };
  } catch (error) {
    console.error('Error in getUserProfile:', error);
    throw error;
  }
};

/**
 * Update user profile data
 * @param {string} userId - The user ID
 * @param {Object} profileData - Profile data to update
 * @returns {Promise<Object>} Updated profile data
 */
export const updateUserProfile = async (userId, profileData) => {
  try {
    // Only allow updating specific fields
    const allowedFields = ['profile_picture_url', 'bio', 'display_name'];
    const updateData = {};
    
    allowedFields.forEach(field => {
      if (profileData[field] !== undefined) {
        updateData[field] = profileData[field];
      }
    });

    // Check if profile exists
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', userId)
      .single();

    if (existingProfile) {
      // Update existing profile
      const { data: updatedProfile, error } = await supabaseAdmin
        .from('user_profiles')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        console.error('Error updating user profile:', error);
        throw error;
      }

      return updatedProfile;
    } else {
      // Create new profile
      const { data: newProfile, error } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: userId,
          ...updateData
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating user profile:', error);
        throw error;
      }

      return newProfile;
    }
  } catch (error) {
    console.error('Error in updateUserProfile:', error);
    throw error;
  }
};

/**
 * Upload profile picture to Supabase Storage
 * @param {string} userId - The user ID
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} fileName - The file name
 * @param {string} contentType - The content type
 * @returns {Promise<string>} The uploaded file URL
 */
export const uploadProfilePicture = async (userId, fileBuffer, fileName, contentType) => {
  try {
    const filePath = `profile-pictures/${userId}/${Date.now()}-${fileName}`;
    
    const { data, error } = await supabaseAdmin.storage
      .from('user-uploads')
      .upload(filePath, fileBuffer, {
        contentType: contentType,
        upsert: false
      });

    if (error) {
      console.error('Error uploading profile picture:', error);
      throw error;
    }

    // Get the public URL
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('user-uploads')
      .getPublicUrl(filePath);

    return publicUrl;
  } catch (error) {
    console.error('Error in uploadProfilePicture:', error);
    throw error;
  }
};

/**
 * Delete profile picture from Supabase Storage
 * @param {string} userId - The user ID
 * @param {string} fileUrl - The file URL to delete
 * @returns {Promise<void>}
 */
export const deleteProfilePicture = async (userId, fileUrl) => {
  try {
    // Extract file path from URL
    const urlParts = fileUrl.split('/');
    const filePath = urlParts.slice(-2).join('/'); // Get the last two parts (userId/filename)
    
    const { error } = await supabaseAdmin.storage
      .from('user-uploads')
      .remove([`profile-pictures/${filePath}`]);

    if (error) {
      console.error('Error deleting profile picture:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in deleteProfilePicture:', error);
    throw error;
  }
};

/**
 * Get profile picture URL for a user
 * @param {string} userId - The user ID
 * @returns {Promise<string|null>} The profile picture URL or null
 */
export const getProfilePictureUrl = async (userId) => {
  try {
    const profile = await getUserProfile(userId);
    return profile.profile_picture_url;
  } catch (error) {
    console.error('Error in getProfilePictureUrl:', error);
    throw error;
  }
}; 