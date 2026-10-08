FROM node:20-alpine

WORKDIR /app

# better-sqlite3 needs build tools to compile its native binding on alpine
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
# exact versions from the lockfile (reproducible, audited builds)
RUN npm ci --omit=dev

COPY server.js extra.js inshore-areas.js auth.js tides.js tide-stations.js ./
COPY tools ./tools
COPY engine/hor-engine.js engine/tide.js ./engine/
COPY public ./public

ENV DATA_DIR=/app/data
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
