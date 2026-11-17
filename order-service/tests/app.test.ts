import request from 'supertest';
import { app, pool } from '../src/app';

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn()
  }))
}));

const mockQuery = pool.query as jest.Mock;

describe('Order Service API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('GET /health', () => {
    it('should return healthy when database is available', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
    });

    it('should return 503 when database is unavailable', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database unavailable'));

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
    });
  });

  describe('POST /orders', () => {
    it('should return 400 when items are missing', async () => {
      const response = await request(app)
        .post('/orders')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 400 when product service returns an error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      const response = await request(app)
        .post('/orders')
        .send({ items: [{ productId: 'product-1', quantity: 1 }] });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /orders', () => {
    it('should return orders with pagination', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'order-1', total: '100.00' }]
        })
        .mockResolvedValueOnce({
          rows: [{ count: '1' }]
        });

      const response = await request(app).get('/orders');

      expect(response.status).toBe(200);
      expect(response.body.orders).toHaveLength(1);
    });
  });

  describe('GET /orders/:id', () => {
    it('should return 404 when order does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/orders/order-123');

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /orders/:id/status', () => {
    it('should return 400 for an invalid status', async () => {
      const response = await request(app)
        .patch('/orders/order-123/status')
        .send({ status: 'invalid' });

      expect(response.status).toBe(400);
    });

    it('should return 404 when order does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .patch('/orders/order-123/status')
        .send({ status: 'confirmed' });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /stats/summary', () => {
    it('should return order statistics', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_orders: '2', total_revenue: '200.00' }]
      });

      const response = await request(app).get('/stats/summary');

      expect(response.status).toBe(200);
    });
  });
});