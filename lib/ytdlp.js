// 📁 lib/ytdlp.js
// Resolves the yt-dlp binary.
// On Railway (Docker): installed at /usr/local/bin/yt-dlp by Dockerfile
// Locally: downloaded to node_modules by postinstall, or project bin/ by build script

import { create } from "youtube-dl-exec";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const platform = process.platform;
const binName  = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

// ── Binary resolution ─────────────────────────────────────────────────────────

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isStandaloneBinary(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    const buf = Buffer.alloc(4);
    const fd  = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] === 0x23 && buf[1] === 0x21) return false;
    return true;
  } catch {
    return false;
  }
}

function findOnPath() {
  try {
    const cmd = platform === "win32" ? "where yt-dlp" : "which yt-dlp";
    const result = execSync(cmd, { encoding: "utf8" }).trim().split("\n")[0].trim();
    if (result && isExecutableFile(result)) return result;
  } catch {
    return null;
  }
  return null;
}

const SYSTEM_CANDIDATES = [
  "/usr/local/bin/yt-dlp",
  "/usr/bin/yt-dlp",
];

const NPM_CANDIDATES = [
  path.join(process.cwd(), "bin", binName),
  path.join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", binName),
];

let resolvedPath = null;

export async function getYtDlp() {
  if (resolvedPath) return create(resolvedPath);

  for (const candidate of SYSTEM_CANDIDATES) {
    if (isExecutableFile(candidate)) {
      resolvedPath = candidate;
      console.log(`[yt-dlp] using system binary: ${resolvedPath}`);
      return create(resolvedPath);
    }
  }

  for (const candidate of NPM_CANDIDATES) {
    if (isStandaloneBinary(candidate)) {
      resolvedPath = candidate;
      console.log(`[yt-dlp] using npm binary: ${resolvedPath}`);
      return create(resolvedPath);
    }
  }

  const onPath = findOnPath();
  if (onPath) {
    resolvedPath = onPath;
    console.log(`[yt-dlp] found on PATH: ${resolvedPath}`);
    return create(resolvedPath);
  }

  console.error("[yt-dlp] binary not found. Checked:");
  for (const c of [...SYSTEM_CANDIDATES, ...NPM_CANDIDATES]) {
    try {
      console.error(`  ${c} — exists: ${fs.existsSync(c)}`);
    } catch {}
  }

  throw new Error("yt-dlp binary not found. On Railway: check Dockerfile. Locally: run npm install.");
}

/**
 * Wraps a yt-dlp call with automatic retry on transient errors
 * (rate limiting, temporary network blips, etc.)
 */
export async function withRetry(fn, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err?.message || "";
      const isTransient =
        msg.includes("429") ||
        msg.includes("rate limit") ||
        msg.includes("Sign in") ||
        (msg.includes("HTTP Error") && !msg.includes("This video is not available"));

      if (attempt === retries || !isTransient) throw err;
      console.warn(`[yt-dlp] attempt ${attempt} failed, retrying in ${delayMs * attempt}ms...`, msg);
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}