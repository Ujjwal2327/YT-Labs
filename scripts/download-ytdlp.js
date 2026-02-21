// 📁 scripts/download-ytdlp.js
/**
 * Postinstall script — downloads the correct yt-dlp binary for the current platform.
 * Runs automatically after `npm install`.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BINARIES = {
  win32:  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  darwin: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
  linux:  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
};

const platform = process.platform;
const url = BINARIES[platform] || BINARIES.linux;
const binDir = path.join(__dirname, "..", "node_modules", "youtube-dl-exec", "bin");
const binName = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const dest = path.join(binDir, binName);

// Skip if already exists
if (fs.existsSync(dest)) {
  console.log(`yt-dlp binary already exists at ${dest}`);
  process.exit(0);
}

fs.mkdirSync(binDir, { recursive: true });

console.log(`Downloading yt-dlp for ${platform} from GitHub...`);

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  https.get(url, (res) => {
    // Follow redirects
    if (res.statusCode === 301 || res.statusCode === 302) {
      file.close();
      return download(res.headers.location, dest, cb);
    }
    res.pipe(file);
    file.on("finish", () => file.close(cb));
  }).on("error", (err) => {
    fs.unlink(dest, () => {});
    cb(err);
  });
}

download(url, dest, (err) => {
  if (err) {
    console.error("Failed to download yt-dlp:", err.message);
    process.exit(1);
  }
  // Make executable on Unix
  if (platform !== "win32") {
    fs.chmodSync(dest, 0o755);
  }
  console.log(`yt-dlp downloaded to ${dest}`);
});