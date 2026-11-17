import { app, redis, logger } from './app';

const PORT = process.env.PORT || 3000;

// Start the API Gateway
const server = app.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');

  server.close(() => {
    redis.disconnect();
    process.exit(0);
  });
});
