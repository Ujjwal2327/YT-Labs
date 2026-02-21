// 📁 lib/ytdlp.js
// Resolves the yt-dlp binary path, downloading it to /tmp if needed.
// This handles Vercel where node_modules is read-only after deploy.

import { create } from "youtube-dl-exec";
import https from "https";
import fs from "fs";
import path from "path";
import os from "os";

const BINARIES = {
  win32:  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  darwin: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
  linux:  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
};

const platform = process.platform;
const binName  = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

// Candidate paths in priority order:
// 1. node_modules bin (works locally after npm install)
// 2. /tmp (writable on Vercel at runtime)
const CANDIDATES = [
  path.join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", binName),
  path.join(os.tmpdir(), binName),
];

function fileIsExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    // Also check it's a real binary, not a 0-byte or HTML error page
    const stat = fs.statSync(filePath);
    return stat.size > 100_000; // yt-dlp binary is always > 1MB
  } catch {
    return false;
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const follow = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`HTTP ${res.statusCode} downloading yt-dlp`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    };
    follow(url);
  });
}

let resolvedPath = null; // cache so we only resolve once per cold start

export async function getYtDlp() {
  if (resolvedPath) return create(resolvedPath);

  // 1. Check candidates in order
  for (const candidate of CANDIDATES) {
    if (fileIsExecutable(candidate)) {
      resolvedPath = candidate;
      console.log(`[yt-dlp] using binary at ${resolvedPath}`);
      return create(resolvedPath);
    }
  }

  // 2. Download to /tmp
  const tmpBin = path.join(os.tmpdir(), binName);
  const url = BINARIES[platform] || BINARIES.linux;
  console.log(`[yt-dlp] binary not found, downloading from ${url} → ${tmpBin}`);

  await download(url, tmpBin);

  if (platform !== "win32") {
    fs.chmodSync(tmpBin, 0o755);
  }

  resolvedPath = tmpBin;
  console.log(`[yt-dlp] downloaded to ${resolvedPath}`);
  return create(resolvedPath);
}