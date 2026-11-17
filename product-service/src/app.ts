import express from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { Pool } from 'pg';
import Redis from 'ioredis';
import winston from 'winston';

const app = express();
const PORT = process.env.PORT || 3002;

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'product-service' },
  transports: [new winston.transports.Console({ format: winston.format.simple() })]
});

// Database
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'products',
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
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        category VARCHAR(100),
        stock INTEGER DEFAULT 0,
        image_url VARCHAR(500),
        tags TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
      CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
      CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN(tags);
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
    res.json({ status: 'healthy', service: 'product-service', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'unhealthy', service: 'product-service' });
  }
});

// List products with pagination and search
app.get('/products', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, minPrice, maxPrice, sort = 'created_at', order = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = 'SELECT * FROM products WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category) {
      query += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (minPrice) {
      query += ` AND price >= $${paramIndex}`;
      params.push(minPrice);
      paramIndex++;
    }

    if (maxPrice) {
      query += ` AND price <= $${paramIndex}`;
      params.push(maxPrice);
      paramIndex++;
    }

    // Validate sort field
    const allowedSorts = ['created_at', 'price', 'name', 'stock'];
    const sortField = allowedSorts.includes(sort as string) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${sortOrder} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(Number(limit), offset);

    const result = await pool.query(query, params);

    const countResult = await pool.query('SELECT COUNT(*) FROM products');
    const total = parseInt(countResult.rows[0].count);

    res.json({
      products: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (err) {
    logger.error('List products error:', err);
    res.status(500).json({ error: 'Failed to list products' });
  }
});

// Get product by ID
app.get('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check cache
    const cached = await redis.get(`product:${id}`);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = result.rows[0];
    await redis.setex(`product:${id}`, 300, JSON.stringify(product));

    res.json(product);
  } catch (err) {
    logger.error('Get product error:', err);
    res.status(500).json({ error: 'Failed to get product' });
  }
});

// Create product
app.post('/products', async (req, res) => {
  try {
    const { name, description, price, category, stock, imageUrl, tags } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Name and price required' });
    }

    const result = await pool.query(
      'INSERT INTO products (name, description, price, category, stock, image_url, tags) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, description, price, category, stock || 0, imageUrl, tags || []]
    );

    logger.info(`Product created: ${result.rows[0].id}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Update product
app.put('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, stock, imageUrl, tags } = req.body;

    const result = await pool.query(
      `UPDATE products SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        price = COALESCE($3, price),
        category = COALESCE($4, category),
        stock = COALESCE($5, stock),
        image_url = COALESCE($6, image_url),
        tags = COALESCE($7, tags),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 RETURNING *`,
      [name, description, price, category, stock, imageUrl, tags, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await redis.del(`product:${id}`);

    logger.info(`Product updated: ${id}`);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete product
app.delete('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await redis.del(`product:${id}`);

    logger.info(`Product deleted: ${id}`);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    logger.error('Delete product error:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Seed data
app.post('/seed', async (req, res) => {
  try {
    const products = [
      { name: 'Wireless Headphones', description: 'Premium noise-cancelling headphones', price: 299.99, category: 'Electronics', stock: 50, tags: ['audio', 'wireless'] },
      { name: 'Mechanical Keyboard', description: 'Cherry MX switches, RGB backlight', price: 149.99, category: 'Electronics', stock: 30, tags: ['keyboard', 'gaming'] },
      { name: 'Ergonomic Mouse', description: 'Vertical design for comfort', price: 79.99, category: 'Electronics', stock: 100, tags: ['mouse', 'ergonomic'] },
      { name: 'Standing Desk', description: 'Electric height adjustable', price: 599.99, category: 'Furniture', stock: 15, tags: ['desk', 'standing'] },
      { name: 'Monitor Arm', description: 'Dual monitor mount', price: 89.99, category: 'Furniture', stock: 40, tags: ['monitor', 'arm'] },
    ];

    for (const product of products) {
      await pool.query(
        'INSERT INTO products (name, description, price, category, stock, tags) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
        [product.name, product.description, product.price, product.category, product.stock, product.tags]
      );
    }

    logger.info('Database seeded');
    res.json({ message: 'Database seeded successfully' });
  } catch (err) {
    logger.error('Seed error:', err);
    res.status(500).json({ error: 'Failed to seed database' });
  }
});

export { app, pool, redis, logger, initDB };
