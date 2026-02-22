// 📁 lib/ytdlp.js
// Resolves the yt-dlp binary across all deployment environments:
//   • Railway / Docker  → /usr/local/bin/yt-dlp  (installed by Dockerfile)
//   • Vercel Lambda     → ./bin/yt-dlp bundled via outputFileTracingIncludes
//   • Local dev         → bin/yt-dlp downloaded by postinstall script

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

/** Returns true if the file looks like a standalone native binary (ELF/Mach-O/PE),
 *  not a shell/Python wrapper script. */
function isStandaloneBinary(filePath) {
  try {
    const buf = Buffer.alloc(4);
    const fd  = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // 0x23 0x21 = "#!" shebang → script wrapper, not standalone
    if (buf[0] === 0x23 && buf[1] === 0x21) return false;
    return true;
  } catch {
    return false;
  }
}

/** Attempt to ensure the file is executable. No-op if it already is or on failure. */
function ensureExecutable(filePath) {
  try {
    fs.chmodSync(filePath, 0o755);
  } catch (_) {}
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
  "/usr/local/bin/yt-dlp",  // Railway Docker / Debian
  "/usr/bin/yt-dlp",
];

// Vercel Lambda: Next.js copies traced files relative to the *function root*,
// which is typically <project>/.next/server/ — so we need to check both the
// project root bin/ (local dev) and the paths Vercel uses at runtime.
const NPM_CANDIDATES = [
  // Project-root bin/ — works locally and is bundled into Vercel via outputFileTracingIncludes
  path.join(process.cwd(), "bin", binName),
  // Vercel Lambda function root (process.cwd() is /var/task at runtime)
  path.join("/var/task", "bin", binName),
  // youtube-dl-exec npm package fallback
  path.join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", binName),
];

let resolvedPath = null;

export async function getYtDlp() {
  if (resolvedPath) return create(resolvedPath);

  // 1. System binaries (Railway/Docker)
  for (const candidate of SYSTEM_CANDIDATES) {
    if (isExecutableFile(candidate)) {
      resolvedPath = candidate;
      console.log(`[yt-dlp] using system binary: ${resolvedPath}`);
      return create(resolvedPath);
    }
  }

  // 2. Standalone binaries in known project/Lambda paths
  for (const candidate of NPM_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      // Ensure executable bit is set — Vercel may strip it during bundling
      ensureExecutable(candidate);
      if (isStandaloneBinary(candidate)) {
        resolvedPath = candidate;
        console.log(`[yt-dlp] using bundled binary: ${resolvedPath}`);
        return create(resolvedPath);
      }
    }
  }

  // 3. PATH fallback
  const onPath = findOnPath();
  if (onPath) {
    resolvedPath = onPath;
    console.log(`[yt-dlp] found on PATH: ${resolvedPath}`);
    return create(resolvedPath);
  }

  // Diagnostic output to help debug future issues
  console.error("[yt-dlp] binary not found. Checked:");
  for (const c of [...SYSTEM_CANDIDATES, ...NPM_CANDIDATES]) {
    try {
      console.error(`  ${c} — exists: ${fs.existsSync(c)}, executable: ${isExecutableFile(c)}`);
    } catch {}
  }
  console.error(`  cwd: ${process.cwd()}`);

  throw new Error(
    "yt-dlp binary not found. " +
    "On Railway: check Dockerfile. " +
    "On Vercel: ensure bin/yt-dlp is committed and next.config.mjs has outputFileTracingIncludes. " +
    "Locally: run npm install."
  );
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