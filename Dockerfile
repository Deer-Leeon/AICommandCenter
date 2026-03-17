FROM node:22-alpine

WORKDIR /app

# Install backend dependencies first (own layer — cached unless package.json changes)
COPY nexus/backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install

# Copy backend source and optional tokens file
WORKDIR /app
COPY nexus/backend/ ./backend/
COPY nexus/tokens.json* ./

# Compile TypeScript
WORKDIR /app/backend
RUN npx tsc

EXPOSE 3001

CMD ["node", "dist/index.js"]
