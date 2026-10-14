import { supabase, deletionAdmin, hasServiceRoleKey } from '../config/supabase.js';
import { isMissingDeletionStore, shouldBlockAuthenticatedRoute } from '../services/deletionRules.js';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;

    if (!shouldBlockAuthenticatedRoute(req.path, { state: 'in_progress' })) {
      return next();
    }

    if (!hasServiceRoleKey || !deletionAdmin) {
      console.error('Deletion lock check unavailable: SUPABASE_SERVICE_ROLE_KEY is not set');
      return res.status(503).json({
        error: 'Could not verify account state. You can sign out or contact support.',
        code: 'deletion_unconfigured',
      });
    }

    const { data: job, error: jobError } = await deletionAdmin
      .from('deletion_jobs')
      .select('state')
      .eq('user_id', user.id)
      .maybeSingle();

    if (jobError) {
      if (isMissingDeletionStore(jobError)) return next();
      console.error('Deletion lock check failed:', jobError.message);
      return res.status(503).json({
        error: 'Could not verify account state. You can retry deletion, sign out, or contact support.',
        code: 'deletion_state_unreadable',
      });
    }

    if (shouldBlockAuthenticatedRoute(req.path, job)) {
      return res.status(409).json({
        error: 'Account deletion is in progress. You can retry deletion, sign out, or contact support.',
        code: 'deletion_in_progress',
      });
    }

    next();
  } catch (error) {
    if (isMissingDeletionStore(error)) return next();
    if (req.user) {
      console.error('Deletion lock check failed:', error.message);
      return res.status(503).json({
        error: 'Could not verify account state. You can retry deletion, sign out, or contact support.',
        code: 'deletion_state_unreadable',
      });
    }
    console.error('Auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};
