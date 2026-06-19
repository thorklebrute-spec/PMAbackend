import { Router } from 'express';
import { calculateAndSaveLifestyleScore, getLatestLifestyleScore } from '../services/lifestyleService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.post('/lifestyle/score', authenticateToken, async (req, res) => {
  try {
    const scoreData = await calculateAndSaveLifestyleScore(req.user.id, req.body);
    res.json(scoreData);
  } catch (error) {
    if (error.message === 'Onboarding data is required' || error.message.startsWith('Missing field:')) {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 'CALCULATE_FAILED') {
      return res.status(500).json({ error: 'Failed to calculate lifestyle score', details: error.details });
    }
    console.error('Lifestyle score calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate lifestyle score' });
  }
});

router.get('/lifestyle/score', authenticateToken, async (req, res) => {
  try {
    const score = await getLatestLifestyleScore(req.user.id);
    if (!score) {
      return res.status(404).json({ error: 'No lifestyle score found' });
    }
    res.json(score);
  } catch (error) {
    console.error('Error fetching lifestyle score:', error);
    res.status(500).json({ error: 'Failed to fetch lifestyle score' });
  }
});

export default router;
