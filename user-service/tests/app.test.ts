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

// Retrieve the Redis instance created by app.ts
const RedisMock = jest.requireMock('ioredis');
const mockRedisInstance = RedisMock.mock.results[0].value;

describe('User Service API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return healthy when database is available', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('user-service');
    });

    it('should return 503 when database is unavailable', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database unavailable'));

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
    });
  });

  describe('POST /auth/register', () => {
    it('should return 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'Email, username, and password required'
      );
    });
  });

  describe('POST /auth/login', () => {
    it('should return 400 when credentials are missing', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'Email and password required'
      );
    });
  });

  describe('GET /users/:id', () => {
    it('should return 404 when user does not exist', async () => {
      mockRedisInstance.get.mockResolvedValueOnce(null);
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/users/123');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });
  });
});