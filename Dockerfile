# node:24 runs .ts directly via native type stripping — no build step.
# The alpine image is multi-arch and much smaller, so this builds/runs on a
# Raspberry Pi (arm64) too.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.ts"]
