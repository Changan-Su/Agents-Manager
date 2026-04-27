FROM node:22-bookworm-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends ca-certificates tini python3 build-essential \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN apt-get update -y && apt-get purge -y --auto-remove build-essential python3 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data/blobs && chown -R node:node /data /app
USER node
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "tsx", "src/server.ts"]
