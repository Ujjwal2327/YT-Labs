/** @type {import('next').NextConfig} */
const nextConfig = {
  // lib/ytdlp.js spawns bin/yt-dlp via child_process, not `require`/`import`,
  // so Next's automatic file tracer has no static reference to find it. This
  // config forces it into every API route's serverless function bundle.
  // Without it: works with `next dev` locally (files are just on disk), but
  // every request 500s on Vercel with "yt-dlp binary not found" — a totally
  // silent failure mode unless you go looking for this exact line.
  outputFileTracingIncludes: {
    "/api/**": ["./bin/**"],
  },
};

export default nextConfig;
