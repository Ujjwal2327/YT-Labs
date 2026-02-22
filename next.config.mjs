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
};

export default nextConfig;
