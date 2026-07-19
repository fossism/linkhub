FROM mcr.microsoft.com/playwright:v1.41.2-jammy

# Set environment
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Copy package details and install all dependencies
COPY package*.json ./
RUN npm ci

# Copy codebase
COPY . .

EXPOSE 5000

# Start server (which also boots the queue worker)
CMD ["npm", "start"]
