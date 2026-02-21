// 📁 lib/ytdlp.js
// Resolves a standalone yt-dlp binary, downloading it to /tmp if the
// node_modules one is a Python script (which Vercel serverless doesn't have).

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

function isStandaloneBinary(filePath) {
  try {
    // Must exist and be executable
    fs.accessSync(filePath, fs.constants.X_OK);

    // Read first 4 bytes:
    //   ELF binary  → 0x7f 'E' 'L' 'F'
    //   Mach-O      → 0xce/0xcf/0xfe/0xff ...
    //   Python script → '#' '!' ...   ← this is what youtube-dl-exec ships
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);

    // Reject scripts (shebang)
    if (buf[0] === 0x23 && buf[1] === 0x21) return false; // '#!'

    // Accept ELF (Linux) or Mach-O (macOS) or PE (Windows .exe)
    const isElf    = buf[0] === 0x7f && buf[1] === 0x45; // 0x7f 'E'
    const isMachO  = buf[0] === 0xce || buf[0] === 0xcf || buf[0] === 0xca || buf[0] === 0xfe;
    const isPE     = buf[0] === 0x4d && buf[1] === 0x5a; // 'MZ'

    return isElf || isMachO || isPE;
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

let resolvedPath = null; // cached per cold start

export async function getYtDlp() {
  if (resolvedPath) return create(resolvedPath);

  const nodeModulesBin = path.join(
    process.cwd(), "node_modules", "youtube-dl-exec", "bin", binName
  );
  const tmpBin = path.join(os.tmpdir(), binName);

  // 1. Prefer /tmp standalone binary (already downloaded on a previous request)
  if (isStandaloneBinary(tmpBin)) {
    resolvedPath = tmpBin;
    console.log(`[yt-dlp] using cached tmp binary: ${resolvedPath}`);
    return create(resolvedPath);
  }

  // 2. Use node_modules binary only if it's a real standalone binary (not a Python script)
  if (isStandaloneBinary(nodeModulesBin)) {
    resolvedPath = nodeModulesBin;
    console.log(`[yt-dlp] using node_modules binary: ${resolvedPath}`);
    return create(resolvedPath);
  }

  // 3. Download standalone binary to /tmp (Vercel's writable dir)
  const url = BINARIES[platform] || BINARIES.linux;
  console.log(`[yt-dlp] downloading standalone binary → ${tmpBin}`);

  await download(url, tmpBin);

  if (platform !== "win32") {
    fs.chmodSync(tmpBin, 0o755);
  }

  if (!isStandaloneBinary(tmpBin)) {
    throw new Error("Downloaded yt-dlp binary failed validation");
  }

  resolvedPath = tmpBin;
  console.log(`[yt-dlp] downloaded OK: ${resolvedPath}`);
  return create(resolvedPath);
}