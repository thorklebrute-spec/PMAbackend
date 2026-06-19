import { Router } from 'express';
import { getUserProgress, saveUserProgress, getProgressStats, getTodayProgress, populateProgressFromMissions, enrichHealthDataForUnits } from '../services/progress.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/progress', authenticateToken, async (req, res) => {
  try {
    const data = await getUserProgress(req.user.id);
    const enriched = (data || []).map(entry => ({
      ...entry,
      health_data: enrichHealthDataForUnits(entry.health_data)
    }));
    res.json(enriched);
  } catch (error) {
    console.error('Error in progress endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch progress data' });
  }
});

router.post('/progress', authenticateToken, async (req, res) => {
  try {
    const { date, healthData } = req.body;
    const result = await saveUserProgress(req.user.id, date, healthData);
    res.json(result);
  } catch (error) {
    console.error('Error in save progress endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to save progress data' });
  }
});

router.get('/progress/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await getProgressStats(req.user.id);
    res.json(stats);
  } catch (error) {
    console.error('Error in progress stats endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch progress stats' });
  }
});

router.get('/progress/today', authenticateToken, async (req, res) => {
  try {
    const data = await getTodayProgress(req.user.id);
    res.json(data);
  } catch (error) {
    console.error('Error in today\'s progress endpoint:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch today\'s progress' });
  }
});


router.post('/progress/populate-from-missions', authenticateToken, async (req, res) => {
  try {
    console.log('🔄 Progress population request received for user:', req.user.id);
    
    const result = await populateProgressFromMissions(req.user.id);
    
    if (result.success) {
      console.log('✅ Progress population successful:', result.message);
      res.json(result);
    } else {
      console.log('⚠️  Progress population failed:', result.message);
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('❌ Error in progress population endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to populate progress from missions' 
    });
  }
});

export default router;
