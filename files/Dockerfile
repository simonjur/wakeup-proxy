# node:24 runs .ts directly via native type stripping — no build step.
# The slim image is multi-arch, so this builds/runs on a Raspberry Pi (arm64).
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.ts"]
