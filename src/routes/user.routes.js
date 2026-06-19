import { Router } from 'express';
import { migrateGuestDataToUser } from '../services/guestMigrationService.js';
import { saveOnboarding, getOnboarding, getOnboardingStatus, getUnitsPreference, updateUnitsPreference } from '../services/userService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.post('/user/migrate-guest-data', authenticateToken, async (req, res) => {
  try {
    const result = await migrateGuestDataToUser(req.user.id, req.body || {});
    res.json(result);
  } catch (error) {
    console.error('Guest data migration error:', {
      message: error.message,
      code: error.code,
      details: error.details,
    });
    const status = error.message?.includes('must') || error.message?.includes('invalid') || error.message?.includes('exceeds')
      ? 400
      : 500;
    res.status(status).json({
      error: error.message || 'Failed to migrate guest data',
    });
  }
});


router.get('/user/onboarding-status', authenticateToken, async (req, res) => {
  try {
    const status = await getOnboardingStatus(req.user.id);
    res.json(status);
  } catch (error) {
    console.error('Error in onboarding-status endpoint:', error);
    return res.status(500).json({ error: 'Failed to fetch onboarding status' });
  }
});


router.post('/user/onboarding', authenticateToken, async (req, res) => {
  try {
    const result = await saveOnboarding(req.user.id, req.body);
    res.json(result);
  } catch (error) {
    if (error.message === 'Onboarding data is required') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error storing onboarding data:', error);
    res.status(500).json({ error: 'Failed to store onboarding data' });
  }
});

router.get('/user/onboarding', authenticateToken, async (req, res) => {
  try {
    const result = await getOnboarding(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error fetching onboarding data:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding data' });
  }
});

router.get('/user/preferences', authenticateToken, async (req, res) => {
  try {
    const result = await getUnitsPreference(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    res.status(500).json({ error: 'Failed to fetch user preferences' });
  }
});

router.patch('/user/preferences', authenticateToken, async (req, res) => {
  try {
    const { unitsPreference } = req.body;
    const result = await updateUnitsPreference(req.user.id, unitsPreference);
    res.json({ success: result.success, unitsPreference: result.unitsPreference });
  } catch (error) {
    if (error.message.startsWith('Invalid unitsPreference')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error updating user preferences:', error);
    res.status(500).json({ error: 'Failed to update user preferences' });
  }
});

export default router;
