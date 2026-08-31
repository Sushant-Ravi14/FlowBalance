# ⚡ FlowBalance Production Container
# Ultra-lightweight Zero-Dependency Node.js Alpine runtime (~45MB)
FROM node:20-alpine

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

WORKDIR /app

# Copy application files (Zero npm dependencies to install!)
COPY . .

# Expose proxy port
EXPOSE 8080 3001 3002 3003

# Container Healthcheck via built-in standard library
HEALTHCHECK --interval=20s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://127.0.0.1:' + (process.env.PORT || 8080) + '/traces', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"

# Launch FlowBalance reverse proxy
CMD ["node", "proxy-server.js"]
