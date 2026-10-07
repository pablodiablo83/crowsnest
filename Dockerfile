FROM node:20-alpine

WORKDIR /app

# better-sqlite3 needs build tools to compile its native binding on alpine
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY server.js extra.js inshore-areas.js auth.js ./
COPY tools ./tools
COPY engine/hor-engine.js ./engine/hor-engine.js
COPY public ./public

ENV DATA_DIR=/app/data
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
