/** Shared settings for manual integration tests. Override via env vars. */
export const API_URL = process.env.API_URL || 'http://localhost:3000';
export const TEST_EMAIL = process.env.TEST_EMAIL || 'blob54037@gmail.com';
export const TEST_PASSWORD = process.env.TEST_PASSWORD || 'PrimalTest1!';
