
import request from 'supertest';
import { app, pool } from '../src/app';

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn()
  }));
});

const mockQuery = pool.query as jest.Mock;

const RedisMock = jest.requireMock('ioredis');
const mockRedisInstance = RedisMock.mock.results[0].value;

describe('Product Service API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return healthy when database is available', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('product-service');
    });

    it('should return 503 when database is unavailable', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database unavailable'));

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
    });
  });

  describe('GET /products', () => {
    it('should return products with pagination', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'product-1', name: 'Keyboard', price: '149.99' }]
        })
        .mockResolvedValueOnce({
          rows: [{ count: '1' }]
        });

      const response = await request(app).get('/products');

      expect(response.status).toBe(200);
      expect(response.body.products).toHaveLength(1);
      expect(response.body.products[0].name).toBe('Keyboard');
      expect(response.body.pagination.total).toBe(1);
    });
  });

  describe('GET /products/:id', () => {
    it('should return cached product when available', async () => {
      const product = { id: 'product-1', name: 'Keyboard', price: '149.99' };

      mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify(product));

      const response = await request(app).get('/products/product-1');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Keyboard');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return 404 when product does not exist', async () => {
      mockRedisInstance.get.mockResolvedValueOnce(null);
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/products/product-123');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Product not found');
    });
  });

  describe('POST /products', () => {
    it('should return 400 when name or price is missing', async () => {
      const response = await request(app)
        .post('/products')
        .send({ name: 'Keyboard' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Name and price required');
    });
  });

  describe('PUT /products/:id', () => {
    it('should return 404 when product does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/products/product-123')
        .send({ name: 'Updated Keyboard' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Product not found');
    });
  });

  describe('DELETE /products/:id', () => {
    it('should return 404 when product does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .delete('/products/product-123');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Product not found');
    });
  });
});
