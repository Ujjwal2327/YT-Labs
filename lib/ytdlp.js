// 📁 lib/ytdlp.js
// Resolves the yt-dlp binary.
// On Railway (Docker): installed at /usr/local/bin/yt-dlp by Dockerfile
// Locally: downloaded to node_modules by postinstall, or project bin/ by build script

import { create } from "youtube-dl-exec";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const platform = process.platform;
const binName  = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

// ── Cookie support ────────────────────────────────────────────────────────────
// Set YTDLP_COOKIES env var in Railway dashboard with your cookies.txt content.
// Export cookies from your browser using the "Get cookies.txt LOCALLY" extension
// while logged into YouTube, then paste the full file content as the env var.
const COOKIE_PATH = path.join(os.tmpdir(), "yt-cookies.txt");
let cookiesWritten = false;

function ensureCookies() {
  if (cookiesWritten) return;
  if (process.env.YTDLP_COOKIES) {
    try {
      fs.writeFileSync(COOKIE_PATH, process.env.YTDLP_COOKIES, "utf8");
      cookiesWritten = true;
      console.log("[yt-dlp] cookies written to", COOKIE_PATH);
    } catch (err) {
      console.warn("[yt-dlp] failed to write cookies:", err.message);
    }
  }
}

export function getCookiePath() {
  ensureCookies();
  return process.env.YTDLP_COOKIES ? COOKIE_PATH : null;
}

// ── Binary resolution ─────────────────────────────────────────────────────────

// For system/known paths: just check if the file exists and is executable.
// We do NOT inspect the binary header here — the Docker install via curl is trusted.
function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// For npm-installed candidates (node_modules): also reject shebang wrapper scripts,
// since youtube-dl-exec sometimes installs a JS/shell wrapper instead of a real binary.
function isStandaloneBinary(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    const buf = Buffer.alloc(4);
    const fd  = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // Reject shebang scripts (#!)
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

// System paths are checked with isExecutableFile (trusted installs).
// npm paths are checked with isStandaloneBinary (may contain wrapper scripts).
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

  // 1. Prefer system-installed binaries (Docker/Railway path)
  for (const candidate of SYSTEM_CANDIDATES) {
    if (isExecutableFile(candidate)) {
      resolvedPath = candidate;
      console.log(`[yt-dlp] using system binary: ${resolvedPath}`);
      return create(resolvedPath);
    }
  }

  // 2. Fall back to project/npm binaries (local dev)
  for (const candidate of NPM_CANDIDATES) {
    if (isStandaloneBinary(candidate)) {
      resolvedPath = candidate;
      console.log(`[yt-dlp] using npm binary: ${resolvedPath}`);
      return create(resolvedPath);
    }
  }

  // 3. Try PATH lookup
  const onPath = findOnPath();
  if (onPath) {
    resolvedPath = onPath;
    console.log(`[yt-dlp] found on PATH: ${resolvedPath}`);
    return create(resolvedPath);
  }

  // Log all candidates for easier debugging
  console.error("[yt-dlp] binary not found. Checked:");
  for (const c of [...SYSTEM_CANDIDATES, ...NPM_CANDIDATES]) {
    try {
      const exists = fs.existsSync(c);
      console.error(`  ${c} — exists: ${exists}`);
    } catch {}
  }

  throw new Error("yt-dlp binary not found. On Railway: check Dockerfile. Locally: run npm install.");
}