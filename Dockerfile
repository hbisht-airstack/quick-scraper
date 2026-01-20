# Multi-stage build for quick-scraper

# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
# Set production environment variables for the frontend build
ARG VITE_API_URL=http://localhost:6001
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Stage 2: Set up the Node.js backend with Puppeteer
FROM node:20 AS backend

# Install Puppeteer dependencies and Google Chrome
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    libappindicator1 \
    libasound2 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libfontconfig1 \
    libgbm-dev \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libicu-dev \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    wget \
    curl \
    gnupg \
    ca-certificates \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*


# Verify Chrome installation
RUN google-chrome-stable --version

# Set up working directory
WORKDIR /app

# Copy backend package.json and install dependencies
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

# Copy backend files
COPY backend/ ./

# Copy built frontend files to the static directory
COPY --from=frontend-build /app/frontend/dist ./public

# Create directory for Puppeteer cache
RUN mkdir -p /opt/render/.cache/puppeteer

# Set environment variables
ENV NODE_ENV=production
ENV PORT=6001
ENV PUPPETEER_EXEC_PATH=/usr/bin/google-chrome-stable
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Expose the port the app runs on
EXPOSE 6001

# Start the server
CMD ["node", "server.js"]
