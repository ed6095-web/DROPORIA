/**
 * Downloads the yt-dlp Linux binary at build time on Render.
 * Skips if the binary already exists (local dev uses yt-dlp.exe).
 */
import https from 'https';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(__dirname, '..', 'yt-dlp');

// Skip on Windows (dev uses yt-dlp.exe)
if (process.platform === 'win32') {
    console.log('[setup] Windows detected — skipping yt-dlp Linux download');
    process.exit(0);
}

if (fs.existsSync(binPath)) {
    console.log('[setup] yt-dlp already exists, skipping download');
    process.exit(0);
}

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
console.log('[setup] Downloading yt-dlp Linux binary...');

const file = fs.createWriteStream(binPath);

function download(url, dest) {
    https.get(url, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
            return download(res.headers.location, dest);
        }
        res.pipe(file);
        file.on('finish', () => {
            file.close();
            fs.chmodSync(binPath, 0o755);
            console.log('[setup] yt-dlp downloaded and made executable ✓');
        });
    }).on('error', err => {
        fs.unlink(binPath, () => {});
        console.error('[setup] Download failed:', err.message);
        process.exit(1);
    });
}

download(YTDLP_URL, binPath);
