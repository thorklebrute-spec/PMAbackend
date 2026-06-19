import { Router } from 'express';
import {
  getUserProfile,
  updateUserProfile,
  uploadProfilePicture,
  deleteProfilePicture,
} from '../services/profileService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.id);
    res.json(profile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { display_name, bio } = req.body;
    
    // Validate input
    if (display_name && display_name.length > 100) {
      return res.status(400).json({ error: 'Display name must be 100 characters or less' });
    }
    
    if (bio && bio.length > 500) {
      return res.status(400).json({ error: 'Bio must be 500 characters or less' });
    }

    const updatedProfile = await updateUserProfile(req.user.id, {
      display_name,
      bio
    });

    res.json(updatedProfile);
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

router.post('/profile/picture', authenticateToken, async (req, res) => {
  try {
    const { image, fileName, mimeType } = req.body;
    
    if (!image || !fileName || !mimeType) {
      return res.status(400).json({ 
        error: 'Missing required fields: image (base64), fileName, mimeType' 
      });
    }

    // Validate that it's a base64 image
    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ 
        error: 'Invalid image format. Must be a base64 encoded image.' 
      });
    }

    // Validate mime type
    if (!mimeType.startsWith('image/')) {
      return res.status(400).json({ 
        error: 'Invalid mime type. Only image files are allowed.' 
      });
    }

    // Convert base64 to buffer
    const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, '');
    const fileBuffer = Buffer.from(base64Data, 'base64');

    // Validate file size (5MB limit)
    if (fileBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ 
        error: 'File size too large. Maximum size is 5MB.' 
      });
    }

    // Get current profile to check if there's an existing picture
    const currentProfile = await getUserProfile(req.user.id);
    let oldPictureUrl = null;

    // Upload new picture
    const pictureUrl = await uploadProfilePicture(
      req.user.id,
      fileBuffer,
      fileName,
      mimeType
    );

    // Update profile with new picture URL
    const updatedProfile = await updateUserProfile(req.user.id, {
      profile_picture_url: pictureUrl
    });

    // Delete old picture if it exists
    if (currentProfile.profile_picture_url) {
      try {
        await deleteProfilePicture(req.user.id, currentProfile.profile_picture_url);
      } catch (deleteError) {
        console.error('Error deleting old profile picture:', deleteError);
        // Don't fail the request if deletion fails
      }
    }

    res.json({
      profile: updatedProfile,
      picture_url: pictureUrl
    });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(500).json({ error: 'Failed to upload profile picture' });
  }
});

router.delete('/profile/picture', authenticateToken, async (req, res) => {
  try {
    const currentProfile = await getUserProfile(req.user.id);
    
    if (!currentProfile.profile_picture_url) {
      return res.status(404).json({ error: 'No profile picture found' });
    }

    // Delete the picture from storage
    await deleteProfilePicture(req.user.id, currentProfile.profile_picture_url);

    // Update profile to remove picture URL
    const updatedProfile = await updateUserProfile(req.user.id, {
      profile_picture_url: null
    });

    res.json({
      success: true,
      profile: updatedProfile
    });
  } catch (error) {
    console.error('Error deleting profile picture:', error);
    res.status(500).json({ error: 'Failed to delete profile picture' });
  }
});

export default router;
