# Use Debian-based Node.js image instead of Alpine
FROM node:20

# Install Python and build tools
RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  make \
  g++ \
  chromium \
  ca-certificates \
  fonts-freefont-ttf \
  && rm -rf /var/lib/apt/lists/*

# Puppeteer needs Chromium path
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
COPY embeddings.json ./
RUN npm install

# Copy rest of the app
COPY . .

# Expose port
EXPOSE 3000

# Healthcheck (optional)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node healthcheck.js || exit 1

# Start app
CMD ["node", "index.js"]
