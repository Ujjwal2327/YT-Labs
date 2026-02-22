# 📁 Dockerfile
FROM node:20-slim

# Install ffmpeg, curl, python3
RUN apt-get update && apt-get install -y ffmpeg curl python3 && rm -rf /var/lib/apt/lists/*

# Download yt-dlp standalone binary.
# --fail makes curl exit non-zero on HTTP errors (404 etc.) so the build fails loudly.
# --location follows redirects.
RUN curl --fail --location \
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
    -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version

WORKDIR /app

COPY package*.json ./
# Copy scripts folder before npm install so the postinstall script exists
COPY scripts/ ./scripts/
RUN npm install --legacy-peer-deps

COPY . .

# Limit Node memory during build to avoid OOM on Railway free tier
ENV NODE_OPTIONS="--max-old-space-size=512"
RUN npm run build

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
ENV NODE_OPTIONS=""

CMD ["npm", "start"]