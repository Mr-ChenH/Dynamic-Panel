FROM node:22.14.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations

RUN groupadd --system dynamic-panel && useradd --system --gid dynamic-panel --home /app dynamic-panel \
    && mkdir -p /var/lib/dynamic-panel/objects /var/lib/dynamic-panel/backups \
    && chown -R dynamic-panel:dynamic-panel /app /var/lib/dynamic-panel
USER dynamic-panel

EXPOSE 43822
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:43822/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
