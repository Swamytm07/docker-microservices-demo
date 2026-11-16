import express from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';
import Redis from 'ioredis';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';

const app = express();
const PORT = process.env.PORT || 3001;

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'user-service' },
  transports: [new winston.transports.Console({ format: winston.format.simple() })]
});

// Database
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'users',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'secret',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Redis
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

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
// Initialize database
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('Database initialized');
  } catch (err) {
    logger.error('Database init failed:', err);
  }
}

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'user-service', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'unhealthy', service: 'user-service' });
  }
});

// Register
app.post('/auth/register', async (req, res) => {
  try {
    const { email, username, password, fullName } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password required' });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, username, password_hash, full_name) VALUES ($1, $2, $3, $4) RETURNING id, email, username, full_name, role, created_at',
      [email, username, passwordHash, fullName || null]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    logger.info(`User registered: ${user.email}`);
    res.status(201).json({ user, token });
  } catch (err) {
    logger.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    // Cache user in Redis
    await redis.setex(`user:${user.id}`, 3600, JSON.stringify({
      id: user.id, email: user.email, username: user.username, role: user.role
    }));

    logger.info(`User logged in: ${user.email}`);
    res.json({ user: { id: user.id, email: user.email, username: user.username, role: user.role }, token });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get user profile
app.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check cache first
    const cached = await redis.get(`user:${id}`);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const result = await pool.query(
      'SELECT id, email, username, full_name, role, created_at FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    await redis.setex(`user:${id}`, 3600, JSON.stringify(user));

    res.json(user);
  } catch (err) {
    logger.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update user profile
app.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, username } = req.body;

    const result = await pool.query(
      'UPDATE users SET full_name = COALESCE($1, full_name), username = COALESCE($2, username), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING id, email, username, full_name, role, created_at',
      [fullName, username, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Invalidate cache
    await redis.del(`user:${id}`);

    logger.info(`User updated: ${id}`);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Start
initDB().then(() => {
  app.listen(PORT, () => {
    logger.info(`User service running on port ${PORT}`);
  });
});

export { app };
