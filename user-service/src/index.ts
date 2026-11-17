import { app, initDB, redis, pool, logger } from './app';

const PORT = process.env.PORT || 3001;

async function startServer() {
  await initDB();

  const server = app.listen(PORT, () => {
    logger.info(`User service running on port ${PORT}`);
  });

  const shutdown = async () => {
    logger.info('Shutting down User Service...');

    server.close(async () => {
      await pool.end();
      redis.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();