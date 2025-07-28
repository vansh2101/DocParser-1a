# Use official Node.js image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install system dependencies for pdf-poppler
RUN apt-get update && \
    apt-get install -y poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY . .

# Create input and output directories (for local testing; will be mounted in container)
RUN mkdir -p /app/input /app/output

# Entrypoint script to process all PDFs in /app/input
COPY docker_entrypoint.sh /docker_entrypoint.sh
RUN chmod +x /docker_entrypoint.sh

ENTRYPOINT ["/docker_entrypoint.sh"]
