import { Router } from 'express';
import { generateOrGetWeeklyCoachReport } from '../services/aiCoachService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.post('/ai/coach/weekly-report', authenticateToken, async (req, res) => {
  try {
    const { reportDay = 'Sunday', personality = 'balanced' } = req.body || {};
    const report = await generateOrGetWeeklyCoachReport(req.user.id, {
      reportDay,
      personality,
    });
    res.json(report);
  } catch (error) {
    console.error('AI coach weekly report error:', {
      message: error.message,
      code: error.code,
      details: error.details,
    });
    res.status(500).json({
      error: error.message || 'Failed to generate weekly AI coach report',
    });
  }
});

export default router;
