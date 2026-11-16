# Microservices Architecture

## 1. Application Architecture

The application follows a three-tier microservices architecture.

Application Flow:

Client / Browser
    |
    v
Nginx Reverse Proxy (Port 80)
    |
    v
API Gateway (Port 3000)
    |
    +---- User Service (Port 3001)
    |
    +---- Product Service (Port 3002)
    |
    +---- Order Service (Port 3003)

Data Layer:
- PostgreSQL Database
- Redis Cache

The User, Product and Order services communicate with PostgreSQL and Redis.
The Order Service also communicates with the Product Service.

## 2. Monitoring Architecture

Application Services and Infrastructure Exporters
    |
    v
Prometheus
    |
    v
Grafana Monitoring Dashboard

Prometheus collects application and infrastructure metrics.
Grafana displays the collected metrics through dashboards.

## 3. Planned AWS Deployment Architecture

The target deployment uses one Ubuntu EC2 instance and three Amazon ECR repositories for the three microservices.

Developer
    |
    v
GitHub Repository
    |
    v
Jenkins CI/CD on Existing Build Server
    |
    v
Amazon ECR (Three Repositories)
    |
    v
Ubuntu EC2 Instance
    |
    v
Nginx -> API Gateway -> User, Product and Order Services
                              |
                              v
                       PostgreSQL and Redis

Prometheus and Grafana provide monitoring.

## 4. Network and Security

- Nginx is the public application entry point.
- Application services communicate over private Docker networks.
- PostgreSQL and Redis must not be publicly accessible.
- Prometheus and Grafana must be restricted to administrative access.
- SSH access must be restricted to an authorized IP address.
- Secrets and AWS credentials must never be committed to Git.

## 5. CI/CD Deployment Flow

1. Developer pushes code to GitHub.
2. Jenkins checks out the repository.
3. Jenkins validates and builds the application.
4. Docker images for the three microservices are pushed to Amazon ECR.
5. Jenkins deploys the application to EC2 using Docker Compose.
6. Health checks verify deployment.
7. Prometheus collects metrics and Grafana displays dashboards.
8. A previous image version can be redeployed if a deployment fails.
