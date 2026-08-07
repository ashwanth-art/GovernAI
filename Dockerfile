# syntax=docker/dockerfile:1

# GovernAI — Node image for Azure Container Apps.
#
# Two stages: the builder keeps devDependencies (vite, vinext, the Cloudflare plugin
# and typescript are all build-time only), and the runtime stage carries just the
# build output plus production dependencies.

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# sharp ships prebuilt binaries but still wants libvips' runtime deps present.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# dist/server/vinext-externals.json is empty: the build bundles every dependency into
# index.js, so next, @next, react-dom and drizzle-orm are never require()d at runtime.
# Installing them anyway added 446 MB. sharp is the one genuine runtime dependency —
# it is loaded dynamically by the /_vinext/image handler — so it is the only install.
# Verified by serving the app with the others deleted from node_modules.
RUN npm install --no-save --omit=dev sharp@0.35.3 \
 && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY server ./server

# Run unprivileged. The node image ships a `node` user; nothing is written at runtime.
USER node

EXPOSE 8080

# No shell form, so the process is PID 1 and receives Container Apps' SIGTERM directly.
CMD ["node", "server/node.mjs"]
