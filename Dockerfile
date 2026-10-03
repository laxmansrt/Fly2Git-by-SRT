# Fly2Git Backend — Production Container
# Node.js 20 Alpine minimal base image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy necessary production backend files and root shared modules
COPY analytics.js ./
COPY automation-rules.js ./
COPY backend/ ./backend/

# Ensure runtime user is non-root
USER node

EXPOSE 8080

# Production startup
CMD ["node", "backend/server.js"]
