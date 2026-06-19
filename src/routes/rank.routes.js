import { Router } from 'express';
import { getUserRank, getLeaderboard, getDailyPoints } from '../services/rankSystem.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/rank', authenticateToken, async (req, res) => {
  try {
    const rankData = await getUserRank(req.user.id);
    res.json(rankData);
  } catch (error) {
    console.error('Error fetching user rank:', error);
    res.status(500).json({ error: 'Failed to fetch user rank' });
  }
});

router.get('/rank/leaderboard', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = await getLeaderboard(limit);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

router.get('/rank/daily-points', authenticateToken, async (req, res) => {
  try {
    const dailyPoints = await getDailyPoints(req.user.id, req.query.date);
    res.json(dailyPoints);
  } catch (error) {
    console.error('Error fetching daily points:', error);
    res.status(500).json({ error: 'Failed to fetch daily points' });
  }
});

export default router;
