// 📁 scripts/download-ytdlp.js
// Downloads the standalone yt-dlp binary into bin/ at install/build time.
//
// This is the ONLY extraction engine now (see lib/ytdlp.js) — there's no
// system-package or Docker-installed fallback anymore, so this script
// succeeding is a hard requirement, not a nice-to-have.
//
// yt-dlp ships multiple releases a week to keep up with YouTube changing
// things. On Vercel this is never a problem: bin/ is gitignored, so every
// deploy starts from a clean checkout and downloads latest. Locally, a
// binary that's already present is normally left alone (to avoid
// re-downloading on every `npm install`) — but if it's more than a day old
// we refresh it anyway, so a laptop that hasn't run `npm install` in a
// while doesn't silently keep using a months-stale extractor.

const https = require("https");
const fs = require("fs");
const path = require("path");

// NOTE: the asset literally named "yt-dlp" (no suffix) is a ~3MB Python
// zipapp that needs a system python3 to run — Vercel's Node.js Lambda
// runtime doesn't have one, so it would fail on every invocation with an
// unhelpful "exec format" or "python3 not found" style error. "yt-dlp_linux"
// is the real standalone build (PyInstaller, ~40MB, zero runtime deps) and
// is the one that actually works in a Node-only container.
const BINARIES = {
  win32: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  darwin:
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
  linux:
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
};

const platform = process.platform;
const url = BINARIES[platform] || BINARIES.linux;
const binName = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binDir = path.join(__dirname, "..", "bin");
const dest = path.join(binDir, binName);

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

function isStandaloneBinary(filePath) {
  try {
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] === 0x23 && buf[1] === 0x21) return false; // "#!" shebang script
    return true; // ELF / Mach-O / PE
  } catch {
    return false;
  }
}

function isFresh(filePath) {
  try {
    return Date.now() - fs.statSync(filePath).mtimeMs < MAX_AGE_MS;
  } catch {
    return false;
  }
}

const hasUsableBinary = isStandaloneBinary(dest);

if (hasUsableBinary && isFresh(dest)) {
  console.log(`[yt-dlp] ${dest} is present and < 1 day old, skipping download`);
  process.exit(0);
}

fs.mkdirSync(binDir, { recursive: true });
console.log(`[yt-dlp] downloading latest standalone binary for ${platform}...`);

function download(url, dest, cb, redirectsLeft = 5) {
  https
    .get(url, (res) => {
      // GitHub's "latest" download links are typically 2 redirects deep
      // (github.com -> github.com/releases/download/vX/asset -> a signed
      // release-assets.githubusercontent.com URL). Only create the file
      // stream once we're at the real 200 response — reusing one write
      // stream across redirects silently breaks on multi-hop chains.
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume(); // discard this body so the socket can be reused
        if (redirectsLeft <= 0) return cb(new Error("Too many redirects"));
        return download(res.headers.location, dest, cb, redirectsLeft - 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return cb(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(cb));
      file.on("error", (err) => {
        fs.unlink(dest, () => {});
        cb(err);
      });
    })
    .on("error", (err) => {
      fs.unlink(dest, () => {});
      cb(err);
    });
}

download(url, dest, (err) => {
  if (err) {
    console.warn("[yt-dlp] download failed:", err.message);
    if (isStandaloneBinary(dest)) {
      console.warn(
        "[yt-dlp] keeping the existing (possibly stale) binary and continuing",
      );
      process.exit(0);
    }
    // No usable binary at all (fresh clone + network hiccup, e.g.) — fail
    // loudly. Every route depends on this binary now, so a silent success
    // here just becomes a confusing 500 on every request later.
    console.error(
      "[yt-dlp] no existing binary to fall back to — failing the build.",
    );
    process.exit(1);
  }
  if (platform !== "win32") fs.chmodSync(dest, 0o755);
  console.log(`[yt-dlp] saved to ${dest}`);
});
