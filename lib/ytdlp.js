// 📁 lib/ytdlp.js
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

// Priority order:
// 1. project root bin/       — downloaded at build time, bundled into Vercel
// 2. node_modules bin/       — real binary installed locally by old postinstall
// 3. /tmp                    — last-resort runtime download
const CANDIDATES = [
  path.join(process.cwd(), "bin", binName),
  path.join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", binName),
  path.join(os.tmpdir(), "ytlabs_" + binName),
];

function isStandaloneBinary(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    const buf = Buffer.alloc(4);
    const fd  = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // Reject shebang scripts (#!/...) — youtube-dl-exec ships a Python wrapper
    if (buf[0] === 0x23 && buf[1] === 0x21) return false;
    return true; // ELF / Mach-O / PE .exe
  } catch {
    return false;
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file   = fs.createWriteStream(dest);
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

let resolvedPath = null;

export async function getYtDlp() {
  if (resolvedPath) return create(resolvedPath);

  // Walk candidates — use the first real standalone binary found
  for (const candidate of CANDIDATES) {
    if (isStandaloneBinary(candidate)) {
      resolvedPath = candidate;
      console.log(`[yt-dlp] using binary: ${resolvedPath}`);
      return create(resolvedPath);
    }
  }

  // Nothing found — download to /tmp as last resort
  const tmpBin = path.join(os.tmpdir(), "ytlabs_" + binName);
  const url    = BINARIES[platform] || BINARIES.linux;
  console.log(`[yt-dlp] no binary found, downloading to ${tmpBin}...`);

  await download(url, tmpBin);
  if (platform !== "win32") fs.chmodSync(tmpBin, 0o755);

  if (!isStandaloneBinary(tmpBin)) {
    throw new Error("[yt-dlp] downloaded binary failed validation");
  }

  resolvedPath = tmpBin;
  console.log(`[yt-dlp] downloaded OK: ${resolvedPath}`);
  return create(resolvedPath);
}