# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:24-alpine

WORKDIR /app
RUN apk add --no-cache curl

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist

USER node

EXPOSE 3001

CMD ["node", "dist/index.js"]
