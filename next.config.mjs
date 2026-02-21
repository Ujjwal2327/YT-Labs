/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
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
  ],
};

export default nextConfig;
