import express from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';
import Redis from 'ioredis';
import winston from 'winston';

const app = express();
const PORT = process.env.PORT || 3003;

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'order-service' },
  transports: [new winston.transports.Console({ format: winston.format.simple() })]
});

// Database
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'orders',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'secret',
  max: 20,
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
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        total DECIMAL(10,2) NOT NULL,
        items JSONB NOT NULL,
        shipping_address JSONB,
        payment_method VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
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
    res.json({ status: 'healthy', service: 'order-service', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'unhealthy', service: 'order-service' });
  }
});

// Create order
app.post('/orders', async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod, notes } = req.body;
    const userId = req.headers['x-user-id'] || 'anonymous';

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item' });
    }

    // Validate products exist and calculate total
    let total = 0;
    const validatedItems = [];

    for (const item of items) {
      const productRes = await fetch(`${process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002'}/products/${item.productId}`);
      if (!productRes.ok) {
        return res.status(400).json({ error: `Product ${item.productId} not found` });
      }
      const product = await productRes.json() as { name: string; price: number };
      total += product.price * item.quantity;
      validatedItems.push({ ...item, name: product.name, price: product.price });
    }

    const result = await pool.query(
      'INSERT INTO orders (user_id, total, items, shipping_address, payment_method, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [userId, total, JSON.stringify(validatedItems), JSON.stringify(shippingAddress), paymentMethod, notes]
    );

    // Publish order event
    await redis.publish('order:created', JSON.stringify(result.rows[0]));

    logger.info(`Order created: ${result.rows[0].id} by user ${userId}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// List user orders
app.get('/orders', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'anonymous';
    const { page = 1, limit = 20, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = 'SELECT * FROM orders WHERE user_id = $1';
    const params: any[] = [userId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(Number(limit), offset);

    const result = await pool.query(query, params);

    const countResult = await pool.query('SELECT COUNT(*) FROM orders WHERE user_id = $1', [userId]);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      orders: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (err) {
    logger.error('List orders error:', err);
    res.status(500).json({ error: 'Failed to list orders' });
  }
});

// Get order by ID
app.get('/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'] || 'anonymous';

    const result = await pool.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Get order error:', err);
    res.status(500).json({ error: 'Failed to get order' });
  }
});

// Update order status
app.patch('/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Publish status update
    await redis.publish('order:status_updated', JSON.stringify(result.rows[0]));

    logger.info(`Order ${id} status updated to ${status}`);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Update order status error:', err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Order statistics
app.get('/stats/summary', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'anonymous';

    const result = await pool.query(`
      SELECT
        COUNT(*) as total_orders,
        SUM(total) as total_spent,
        AVG(total) as avg_order_value,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders
      FROM orders WHERE user_id = $1
    `, [userId]);

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Get stats error:', err);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Start
initDB().then(() => {
  app.listen(PORT, () => {
    logger.info(`Order service running on port ${PORT}`);
  });
});

export { app };
