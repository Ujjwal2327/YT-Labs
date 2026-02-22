/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
    ],
  },
  serverExternalPackages: [
    "@distube/ytdl-core",
    "fluent-ffmpeg",
    "@ffmpeg-installer/ffmpeg",
    "youtube-dl-exec",   // needed so Next.js doesn't try to bundle the native binary caller
  ],
  // Tell Next.js to include the yt-dlp binary in Vercel's output file tracing.
  // Without this, Vercel Lambda deployments cannot find the binary at runtime
  // because only files reachable via static import analysis are bundled.
  outputFileTracingIncludes: {
    "/api/playlist":   ["./bin/**"],
    "/api/video":      ["./bin/**"],
    "/api/stream-url": ["./bin/**"],
    "/api/download":   ["./bin/**"],
  },
};

export default nextConfig;
