// 📁 scripts/download-ytdlp.js
// Downloads the standalone yt-dlp binary at build/install time.
// Saves to bin/yt-dlp (project root) so Vercel bundles it into the deployment.

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const BINARIES = {
  win32:  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  darwin: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
  linux:  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
};

const platform = process.platform;
const url      = BINARIES[platform] || BINARIES.linux;
const binName  = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binDir   = path.join(__dirname, "..", "bin");
const dest     = path.join(binDir, binName);

function isStandaloneBinary(filePath) {
  try {
    const buf = Buffer.alloc(4);
    const fd  = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] === 0x23 && buf[1] === 0x21) return false; // shebang script
    return true; // ELF / Mach-O / PE
  } catch {
    return false;
  }
}

// Skip if a real binary already exists
if (isStandaloneBinary(dest)) {
  console.log(`[yt-dlp] standalone binary already at ${dest}, skipping download`);
  process.exit(0);
}

fs.mkdirSync(binDir, { recursive: true });

console.log(`[yt-dlp] downloading standalone binary for ${platform}...`);

function download(url, dest, cb) {
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
        return cb(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(cb));
    }).on("error", (err) => {
      file.close();
      fs.unlink(dest, () => {});
      cb(err);
    });
  };
  follow(url);
}

download(url, dest, (err) => {
  if (err) {
    console.error("[yt-dlp] download failed:", err.message);
    process.exit(1);
  }
  if (platform !== "win32") fs.chmodSync(dest, 0o755);
  console.log(`[yt-dlp] saved to ${dest}`);
});