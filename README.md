# Docker Microservices Demo

Production-ready microservices architecture with Docker Compose, featuring API Gateway, service discovery, and distributed tracing.

## Architecture

```
┌─────────────┐
│   Nginx     │ ← Load Balancer / Reverse Proxy
│   (80)      │
└──────┬──────┘
       │
┌──────▼──────┐
│ API Gateway │ ← Rate Limiting, Auth, Routing
│   (3000)    │
└──────┬──────┘
       │
┌──────┼──────────────┐
│      │              │
▼      ▼              ▼
┌────────┐  ┌────────┐  ┌────────┐
│ User   │  │Product │  │ Order  │
│Service │  │Service │  │Service │
│ (3001) │  │ (3002) │  │ (3003) │
└───┬────┘  └───┬────┘  └───┬────┘
    │           │           │
    └─────┬─────┴─────┬─────┘
          │           │
     ┌────▼────┐ ┌────▼────┐
     │ Redis   │ │PostgreSQL│
     │ Cache   │ │Database │
     └─────────┘ └─────────┘
```

## Services

- **API Gateway**: Centralized entry point with JWT auth, rate limiting, request validation
- **User Service**: Registration, authentication, profile management
- **Product Service**: CRUD operations, inventory management, search
- **Order Service**: Order processing, payment simulation, order history
- **Nginx**: Load balancing, static file serving, SSL termination

## Tech Stack

- Node.js + Express
- PostgreSQL + Redis
- Docker + Docker Compose
- Nginx reverse proxy
- JWT authentication
- Winston logging
- Jest + Supertest testing

## Quick Start

```bash
# Clone and start
git clone https://github.com/null8878/docker-microservices-demo.git
cd docker-microservices-demo
docker-compose up -d

# Run migrations
docker-compose exec user-service npm run migrate
docker-compose exec product-service npm run migrate
docker-compose exec order-service npm run migrate

# Seed data
docker-compose exec product-service npm run seed

# Access API
curl http://localhost/api/health
curl http://localhost/api/products
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh JWT

### Products
- `GET /api/products` - List products (with pagination, search)
- `GET /api/products/:id` - Get product details
- `POST /api/products` - Create product (admin)
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Orders
- `GET /api/orders` - List user orders
- `POST /api/orders` - Create order
- `GET /api/orders/:id` - Get order details
- `PATCH /api/orders/:id/status` - Update order status

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=secret
POSTGRES_DB=microservices

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# Services
USER_SERVICE_URL=http://user-service:3001
PRODUCT_SERVICE_URL=http://product-service:3002
ORDER_SERVICE_URL=http://order-service:3003
```

## Testing

```bash
# Run all tests
docker-compose exec user-service npm test
docker-compose exec product-service npm test
docker-compose exec order-service npm test

# Run integration tests
npm run test:integration
```

## Monitoring

- Prometheus metrics at `http://localhost:9090`
- Grafana dashboards at `http://localhost:3000` (admin/admin)
- Service logs: `docker-compose logs -f [service]`

## License

MIT

<!-- CI auto-trigger test -->
