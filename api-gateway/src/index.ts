import express from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { createProxyMiddleware } from 'http-proxy-middleware';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';

const app = express();
const PORT = process.env.PORT || 3000;

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'api-gateway' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Redis client
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  retryStrategy: (times) => Math.min(times * 50, 2000)
});

redis.on('error', (err) => logger.error('Redis error:', err));
redis.on('connect', () => logger.info('Redis connected'));

// Rate limiter
const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl',
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000') / 1000,
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
// Prometheus metrics configuration
const register = new Registry();

collectDefaultMetrics({ register });

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
  try {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end('Unable to generate metrics');
  }
});

// HTTP request metrics middleware
app.use((req, res, next) => {
  const startTime = process.hrtime();

  res.on('finish', () => {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    const route = req.route
      ? `${req.baseUrl}${req.route.path}`
      : 'unmatched';

    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode.toString()
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });

  next();
});

// Request ID middleware
// Request ID middleware
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();

  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);

  next();
});

// Rate limiting middleware
app.use(async (req, res, next) => {
  try {
    const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
    await rateLimiter.consume(clientIP);
    next();
  } catch {
    logger.warn(`Rate limit exceeded for ${req.ip}`);
    res.status(429).json({ error: 'Too many requests', retryAfter: 60 });
  }
});

// Health check
app.get('/health', async (req, res) => {
  const services = {
    'user-service': await checkService(process.env.USER_SERVICE_URL || 'http://localhost:3001'),
    'product-service': await checkService(process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002'),
    'order-service': await checkService(process.env.ORDER_SERVICE_URL || 'http://localhost:3003'),
    redis: redis.status === 'ready'
  };

  const allHealthy = Object.values(services).every(v => v);
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    services,
    timestamp: new Date().toISOString()
  });
});

async function checkService(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

// Auth middleware for protected routes
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Service proxies
app.use('/api/auth', createProxyMiddleware({
  target: process.env.USER_SERVICE_URL || 'http://localhost:3001',
  changeOrigin: true,
  pathRewrite: { '^/api/auth': '/auth' },
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('X-Gateway-Time', Date.now().toString());
  },
  onError: (err, req, res) => {
    logger.error('User service error:', err);
    (res as any).status(502).json({ error: 'User service unavailable' });
  }
}));

app.use('/api/users', authenticateToken, createProxyMiddleware({
  target: process.env.USER_SERVICE_URL || 'http://localhost:3001',
  changeOrigin: true,
  pathRewrite: { '^/api/users': '/users' },
  onError: (err, req, res) => {
    logger.error('User service error:', err);
    (res as any).status(502).json({ error: 'User service unavailable' });
  }
}));

app.use('/api/products', createProxyMiddleware({
  target: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002',
  changeOrigin: true,
  pathRewrite: { '^/api/products': '/products' },
  onError: (err, req, res) => {
    logger.error('Product service error:', err);
    (res as any).status(502).json({ error: 'Product service unavailable' });
  }
}));

app.use('/api/orders', authenticateToken, createProxyMiddleware({
  target: process.env.ORDER_SERVICE_URL || 'http://localhost:3003',
  changeOrigin: true,
  pathRewrite: { '^/api/orders': '/orders' },
  onError: (err, req, res) => {
    logger.error('Order service error:', err);
    (res as any).status(502).json({ error: 'Order service unavailable' });
  }
}));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: any, req: any, res: any, next: any) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
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

export { app };
