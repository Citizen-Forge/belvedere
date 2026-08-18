FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:20-alpine AS frontend-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# gitSource.ts shells out to system git for remote library sources (belvedere-library, or any
# third-party source a user configures) — there's no bundled checkout inside the image.
RUN apk add --no-cache git
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /web/dist ./public

EXPOSE 3000
CMD ["node", "dist/index.js"]
