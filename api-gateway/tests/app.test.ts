
import request from 'supertest';

// Mock Redis so tests do not need a running Redis server.
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    status: 'ready',
    on: jest.fn(),
    disconnect: jest.fn()
  }))
}));

// Allow every request through the rate limiter during tests.
jest.mock('rate-limiter-flexible', () => ({
  RateLimiterRedis: jest.fn().mockImplementation(() => ({
    consume: jest.fn().mockResolvedValue({})
  }))
}));

import { app } from '../src/app';

describe('API Gateway', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('GET /health returns healthy when all services are available', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true
    } as Response);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.services).toEqual({
      'user-service': true,
      'product-service': true,
      'order-service': true,
      redis: true
    });
  });

  test('GET /health returns degraded when a service is unavailable', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.services['product-service']).toBe(false);
  });

  test('Unknown routes return HTTP 404', async () => {
    const response = await request(app).get('/invalid-route');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Route not found');
  });
});
