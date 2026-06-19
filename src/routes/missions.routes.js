import { Router } from 'express';
import { getDailyMissions, getDailyMissionStats, getTodayDailyMissions, checkMissionsCompleted } from '../services/dailyMissions.js';
import { checkAndSaveDailyProgress } from '../services/progress.js';
import { validateMissionUncheck, saveDailyMissionsWithSideEffects } from '../services/missionWorkflow.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/daily-missions', authenticateToken, async (req, res) => {
  try {
    const data = await getDailyMissions(req.user.id);
    res.json(data);
  } catch (error) {
    console.error('Error in daily missions endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch daily missions' });
  }
});

router.post('/daily-missions', authenticateToken, async (req, res) => {
  try {
    const { date, missions } = req.body;

    const existingMissions = await getTodayDailyMissions(req.user.id);
    if (validateMissionUncheck(existingMissions, missions)) {
      return res.status(400).json({
        error: 'Cannot uncheck completed missions. Once a mission is completed, it cannot be undone.'
      });
    }

    const result = await saveDailyMissionsWithSideEffects(req.user.id, date, missions);
    res.json(result);
  } catch (error) {
    console.error('Error in save daily missions endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to save daily missions' });
  }
});

router.post('/daily-missions/check-progress', authenticateToken, async (req, res) => {
  try {
    const { date, missions, onboardingData } = req.body;
    
    if (!date || !missions || !onboardingData) {
      return res.status(400).json({ error: 'Date, missions, and onboarding data are required' });
    }

    const result = await checkAndSaveDailyProgress(req.user.id, date, missions, onboardingData);
    res.json(result);
  } catch (error) {
    console.error('Error in check daily progress endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to check daily progress' });
  }
});

router.get('/daily-missions/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await getDailyMissionStats(req.user.id);
    res.json(stats);
  } catch (error) {
    console.error('Error in daily missions stats endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch daily mission stats' });
  }
});

router.get('/daily-missions/today', authenticateToken, async (req, res) => {
  try {
    const data = await getTodayDailyMissions(req.user.id);
    res.json(data);
  } catch (error) {
    console.error('Error in today\'s daily missions endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch today\'s daily missions' });
  }
});

router.get('/daily-missions/completed/:date', authenticateToken, async (req, res) => {
  try {
    const { date } = req.params;
    const isCompleted = await checkMissionsCompleted(req.user.id, date);
    res.json({ completed: isCompleted });
  } catch (error) {
    console.error('Error in check missions completion endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to check missions completion' });
  }
});

export default router;
