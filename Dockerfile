FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY admin/package.json ./admin/package.json
COPY site/package.json ./site/package.json
RUN npm ci --omit=dev \
  && npm cache clean --force

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/site/node_modules ./site/node_modules
COPY --chown=node:node . .

RUN mkdir -p /app/data/backups /app/uploads /app/generated-site/current /app/generated-site/.publish-staging /app/site/src/data /app/site/public/uploads \
  && chown -R node:node /app/data /app/uploads /app/generated-site /app/site/src/data /app/site/public/uploads

ENV NODE_ENV=production
ENV PORT=8080

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
