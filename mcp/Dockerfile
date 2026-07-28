# Notespice MCP server — optional companion container that exposes
# your notes to Claude over the Model Context Protocol.
FROM node:22-alpine

# Links the GHCR package to the repository automatically.
LABEL org.opencontainers.image.source="https://github.com/FOSSCharlie/notespice"
LABEL org.opencontainers.image.description="Notespice MCP server — exposes your notes to Claude"
LABEL org.opencontainers.image.licenses="MIT"

# Keep OS packages patched at build time, mirroring the main image.
RUN apk upgrade --no-cache

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./

USER node
EXPOSE 4200

HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4200/healthz || exit 1

CMD ["node", "server.js"]
