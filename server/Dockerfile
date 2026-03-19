FROM node:20-alpine

WORKDIR /app

# Install deps first (layer cached unless package.json changes)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm install typescript --save-dev && npx tsc

EXPOSE 3001

CMD ["node", "dist/index.js"]
