FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create data directory
RUN mkdir -p xmtp-db

# Run as non-root user
USER node

# Start the agent
CMD ["node", "worker/index.js"]


