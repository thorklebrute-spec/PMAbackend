import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import aiRoutes from './ai.routes.js';
import userRoutes from './user.routes.js';
import lifestyleRoutes from './lifestyle.routes.js';
import missionsRoutes from './missions.routes.js';
import progressRoutes from './progress.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import rankRoutes from './rank.routes.js';
import profileRoutes from './profile.routes.js';

export default function mountRoutes(app) {
  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(aiRoutes);
  app.use(userRoutes);
  app.use(lifestyleRoutes);
  app.use(missionsRoutes);
  app.use(progressRoutes);
  app.use(subscriptionRoutes);
  app.use(rankRoutes);
  app.use(profileRoutes);
}
