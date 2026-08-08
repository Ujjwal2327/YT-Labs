// 📁 lib/ytdlp.js
//
// Resolves and invokes the yt-dlp binary directly via child_process — no
// youtube-dl-exec dependency. That package's preinstall script shells out to
// check for a `python3`/`python` binary on PATH (even though we never use
// its own Python-based install path, since we always pass it our own
// pre-downloaded binary), which fails on plenty of real Windows setups where
// Python is only reachable via the `py` launcher. Since we don't need
// anything else from that package, the simplest permanent fix is to not
// depend on it: this file is a ~30-line replacement for the one function
// (`create`) we actually used, verified to build the exact same CLI flags
// and error shape.
//
// This is the ONLY extraction path (Vercel and local dev both use it) — no
// more separate hand-rolled Innertube implementation, no more Railway/
// system-binary lookup. One path means "works locally" and "works on
// Vercel" are the same claim, which used to not be true here.
//
// IMPORTANT: the binary is invoked via child_process, not `require`/`import`,
// so Next.js's static file tracer cannot discover it on its own. It only
// ends up in the Vercel deployment bundle because next.config.mjs explicitly
// lists bin/** via outputFileTracingIncludes. If that config is ever removed,
// every API route using this file will fail on Vercel with "binary not
// found" while working fine locally — that mismatch is the single most
// likely way this app breaks again in the future.

import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const platform = process.platform;
const binName = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

// Local dev: process.cwd() is the project root.
// Vercel: process.cwd() at runtime can differ from the bundle root, so we
// also check /var/task (the Lambda function root Vercel uses for Node.js
// functions) as a fallback.
const CANDIDATES = [
  path.join(process.cwd(), "bin", binName),
  path.join("/var/task", "bin", binName),
];

function isExecutableFile(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureExecutable(p) {
  try {
    fs.chmodSync(p, 0o755);
  } catch {
    // best-effort — if this fails, isExecutableFile() below will catch it
  }
}

let resolvedPath = null;

function resolveBinary() {
  if (resolvedPath) return resolvedPath;

  for (const candidate of CANDIDATES) {
    if (fs.existsSync(candidate)) {
      // Vercel's bundler sometimes drops the executable bit — restore it
      // before checking, rather than after failing.
      ensureExecutable(candidate);
      if (isExecutableFile(candidate)) {
        resolvedPath = candidate;
        return resolvedPath;
      }
    }
  }

  console.error("[yt-dlp] binary not found. Checked:");
  for (const c of CANDIDATES) {
    console.error(`  ${c} — exists: ${fs.existsSync(c)}`);
  }
  console.error(`  cwd: ${process.cwd()}`);

  throw new Error(
    "yt-dlp binary not found. Locally: run `npm install` (this runs " +
      "scripts/download-ytdlp.js via postinstall). On Vercel: confirm " +
      "next.config.mjs includes bin/** via outputFileTracingIncludes, and " +
      "check the build logs for '[yt-dlp] saved to'.",
  );
}

// ── Minimal CLI wrapper (replaces youtube-dl-exec's `create()`) ───────────

function isJSON(str) {
  return typeof str === "string" && str.startsWith("{");
}

/** camelCase flags object -> CLI args array, e.g. { dumpSingleJson: true, cookies: "/tmp/x" } -> ["--dump-single-json", "--cookies", "/tmp/x"] */
function buildArgs(flags = {}) {
  const args = [];
  for (const [key, value] of Object.entries(flags)) {
    if (value === false || value == null) continue;
    const flag = "--" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    if (value === true) args.push(flag);
    else args.push(flag, String(value));
  }
  return args;
}

async function runYtDlp(binaryPath, url, flags = {}) {
  const args = [url, ...buildArgs(flags)];
  try {
    const { stdout } = await execFileAsync(binaryPath, args, {
      maxBuffer: 64 * 1024 * 1024, // playlist JSON dumps can be a few MB
      windowsHide: true,
    });
    return isJSON(stdout) ? JSON.parse(stdout) : stdout;
  } catch (err) {
    // Node's execFile already attaches .stdout/.stderr/.code to the
    // rejection, but .message gets a "Command failed: ..." wrapper prefixed
    // onto it — normalize to just the stderr text so downstream code
    // (withRetry / friendlyError, both of which read err.stderr || err.message)
    // sees the same thing regardless of how the process failed.
    const stderr = err.stderr || "";
    const wrapped = new Error(stderr || err.message || "yt-dlp failed");
    wrapped.stderr = stderr;
    wrapped.stdout = err.stdout || "";
    wrapped.code = err.code;
    throw wrapped;
  }
}

export async function getYtDlp() {
  const binaryPath = resolveBinary();
  return (url, flags = {}) => runYtDlp(binaryPath, url, flags);
}

// ── Cookies ──────────────────────────────────────────────────────────────
//
// As of 2026 this is the single biggest reliability lever: YouTube now
// frequently returns "Sign in to confirm you're not a bot" (or silently
// withholds most formats) for cookie-less requests, regardless of which
// tool or client is asking.
//
// Two sources, checked in this order per request:
//  1. The visitor's own cookies, pasted into the app and sent via the
//     x-ytdlp-cookies header. Nothing is stored server-side — a temp file
//     is written for this one request and deleted when it's done. This
//     means reliability for a given visitor depends on THEIR cookies, not
//     on the deployer manually refreshing one shared account forever.
//  2. YTDLP_COOKIES, an optional operator-wide fallback env var, for
//     visitors who haven't supplied their own.
//
// Without either, the app still works, but expect more videos to fail.

const MAX_COOKIES_BYTES = 200 * 1024; // real cookies.txt files are a few KB
const NETSCAPE_HEADER = "# Netscape HTTP Cookie File";
const NETSCAPE_MAGIC_RE = /#\s*(Netscape\s+)?HTTP Cookie File/i;

/**
 * yt-dlp (via Python's http.cookiejar) only checks that the FIRST LINE of
 * the file matches NETSCAPE_MAGIC_RE before parsing the rest as tab-
 * separated cookie fields. Several real-world sources of cookie text don't
 * reliably include that line — e.g. some export tools' "copy" button omits
 * it even though their "save file" option includes it — so rather than
 * assume the caller got it right, we normalize line endings/BOM and
 * prepend the canonical header ourselves whenever it's missing.
 */
function toNetscapeCookieFile(text) {
  let content = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLine = content.slice(
    0,
    content.indexOf("\n") + 1 || content.length,
  );
  if (!NETSCAPE_MAGIC_RE.test(firstLine)) {
    content = `${NETSCAPE_HEADER}\n${content}`;
  }
  return content;
}

/**
 * Resolves which cookies file (if any) to use for one request. Returns
 * { filePath, isTemp } — if isTemp is true, the caller MUST call
 * cleanupCookies() on it when the request is done (success or failure).
 */
export async function resolveCookies(req) {
  const encoded = req.headers.get("x-ytdlp-cookies");
  if (encoded && encoded.trim()) {
    let visitorCookies = null;
    try {
      visitorCookies = Buffer.from(encoded, "base64").toString("utf8");
    } catch (e) {
      console.warn(
        "[yt-dlp] failed to decode x-ytdlp-cookies header:",
        e.message,
      );
    }
    if (visitorCookies && visitorCookies.trim()) {
      const trimmed = toNetscapeCookieFile(visitorCookies).slice(
        0,
        MAX_COOKIES_BYTES,
      );
      const filePath = path.join(
        os.tmpdir(),
        `ytlabs-cookies-${randomUUID()}.txt`,
      );
      try {
        await fs.promises.writeFile(filePath, trimmed, "utf8");
        return { filePath, isTemp: true };
      } catch (e) {
        console.warn("[yt-dlp] failed to write visitor cookies:", e.message);
        // fall through to the operator-wide cookie file below
      }
    }
  }
  return { filePath: getEnvCookiesFile(), isTemp: false };
}

export async function cleanupCookies(cookies) {
  if (cookies?.isTemp && cookies.filePath) {
    fs.promises.unlink(cookies.filePath).catch(() => {});
  }
}

let envCookiesFilePath; // undefined = not yet resolved, null = none configured

function getEnvCookiesFile() {
  if (envCookiesFilePath !== undefined) return envCookiesFilePath;

  const raw = process.env.YTDLP_COOKIES;
  if (!raw || !raw.trim()) {
    envCookiesFilePath = null;
    return envCookiesFilePath;
  }

  try {
    const dest = path.join(os.tmpdir(), "ytlabs-cookies-env.txt");
    fs.writeFileSync(dest, toNetscapeCookieFile(raw), "utf8");
    envCookiesFilePath = dest;
  } catch (e) {
    console.warn("[yt-dlp] failed to write YTDLP_COOKIES to disk:", e.message);
    envCookiesFilePath = null;
  }
  return envCookiesFilePath;
}

/** Base options every yt-dlp invocation should include. */
export function baseOpts(extra = {}, cookiesFilePath) {
  const opts = { quiet: true, noWarnings: true, ...extra };
  if (cookiesFilePath) opts.cookies = cookiesFilePath;
  return opts;
}

// ── Retry ────────────────────────────────────────────────────────────────
//
// Only retries errors that have a real chance of being transient (rate
// limiting, network blips). A hard bot-check or "video unavailable" will
// return the exact same result on attempt 2, so retrying just adds latency —
// we fail fast on those instead.

export async function withRetry(fn, retries = 2, delayMs = 1500) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err?.stderr || err?.message || "";
      const nonRetryable =
        /sign in to confirm|not a bot|login_required|private video|video unavailable|has been removed|does not exist/i.test(
          msg,
        );
      if (attempt === retries || nonRetryable) throw err;
      console.warn(
        `[yt-dlp] attempt ${attempt} failed, retrying in ${delayMs}ms…`,
        msg.split("\n")[0],
      );
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastErr;
}

// ── Human-readable errors ───────────────────────────────────────────────
//
// yt-dlp's raw errors are Python stack traces. Translate the common ones so
// the failure is actionable from the UI alone, without needing server logs.

export function friendlyError(err) {
  const raw =
    (err?.stderr || err?.message || String(err) || "Unknown error")
      .split("\n")
      .find((l) => l.trim().length > 0) || "Unknown error";

  if (/sign in to confirm|not a bot|login_required/i.test(raw)) {
    return "YouTube is blocking this request as automated traffic — this is a YouTube-side restriction, not a bug in the app. Add your own YouTube cookies (the cookie icon, top right) to fix this for most videos.";
  }
  if (/private video/i.test(raw)) return "This video is private.";
  if (/video unavailable|has been removed|does not exist/i.test(raw))
    return "This video is unavailable or has been removed.";
  if (/age[- ]restrict/i.test(raw))
    return "This video is age-restricted. Add cookies from an age-verified account (cookie icon, top right) to access it.";
  if (/members-only|join this channel/i.test(raw))
    return "This video is members-only.";
  if (/unsupported url|is not a valid url/i.test(raw))
    return "That doesn't look like a valid YouTube URL.";
  if (/requested format is not available/i.test(raw))
    return "YouTube isn't offering a playable format for this video right now. This is unusual — try again in a moment, or try a different quality setting.";

  return raw.replace(/^ERROR:\s*/i, "").slice(0, 300);
}
