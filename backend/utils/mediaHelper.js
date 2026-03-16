import { instagramGetUrl } from 'instagram-url-direct';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ytdlpBin = path.join(process.cwd(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ffmpegBin = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const execFileAsync = promisify(execFile);

// Write YT_COOKIES env var to a temp file so yt-dlp can use it for auth
const COOKIES_FILE = '/tmp/yt-cookies.txt';
if (process.env.YT_COOKIES && !fs.existsSync(COOKIES_FILE)) {
    try {
        fs.writeFileSync(COOKIES_FILE, process.env.YT_COOKIES, 'utf8');
        console.log('[mediaHelper] Wrote YT_COOKIES to', COOKIES_FILE);
    } catch (e) {
        console.warn('[mediaHelper] Could not write cookies file:', e.message);
    }
}

/**
 * Returns extra yt-dlp args for YouTube auth.
 * @param {boolean} forDownload - if true, adds android player client (better for actual downloads)
 */
function getYtDlpAuthArgs(forDownload = false) {
    const args = [];
    if (forDownload) {
        // Android client bypasses some bot checks during download
        args.push('--extractor-args', 'youtube:player_client=android,web');
    } else {
        // For info fetching, use web/mweb to get greatest range of formats
        args.push('--extractor-args', 'youtube:player_client=web,mweb');
    }
    const cookiesFile = process.env.YT_COOKIES_FILE || (fs.existsSync(COOKIES_FILE) ? COOKIES_FILE : null);
    if (cookiesFile) {
        args.push('--cookies', cookiesFile);
        console.log('[mediaHelper] Using cookies from:', cookiesFile);
    }
    return args;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes, decimals = 2) {
    if (!bytes) return null;
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatDuration(secs) {
    if (!secs) return 'N/A';
    secs = Math.floor(secs);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
}

// ─── YouTube via yt-dlp --dump-json ──────────────────────────────────────────

async function getYouTubeInfo(videoUrl) {
    console.log('[mediaHelper] Fetching YouTube info via yt-dlp --dump-json');

    let stdout = '';
    try {
        const result = await execFileAsync(ytdlpBin, [
            '--dump-json',
            '--no-playlist',
            '--no-check-formats',
            '--quiet',
            ...getYtDlpAuthArgs(false),
            videoUrl
        ], { timeout: 45000, maxBuffer: 20 * 1024 * 1024 });
        stdout = result.stdout;
    } catch (err) {
        stdout = err.stdout || '';
        if (!stdout.trim()) {
            throw new Error(err.stderr?.split('\n').find(l => l.includes('ERROR')) || err.message);
        }
    }

    const info = JSON.parse(stdout);
    const formats = info.formats || [];

    // Split into video-only, audio-only, and combined (muxed)
    const combined  = formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.url);
    const videoOnly = formats.filter(f => f.vcodec !== 'none' && f.acodec === 'none' && f.url);
    const audioOnly = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url && !f.format_note?.includes('DRC') && !f.format_note?.includes('VB'));

    // Best audio for merging (prefer m4a)
    const bestAudio = audioOnly
        .filter(f => f.ext === 'm4a' || f.acodec?.startsWith('mp4a'))
        .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0]
        || audioOnly.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    const downloadable_formats = [];
    const audio_formats = [];

    // Dedupe video-only by height — prefer avc1/mp4
    const heightMap = {};
    for (const f of videoOnly) {
        const h = f.height;
        if (!h) continue;
        const existing = heightMap[h];
        const fIsH264 = f.vcodec?.startsWith('avc1') || f.ext === 'mp4';
        const existingIsH264 = existing && (existing.vcodec?.startsWith('avc1') || existing.ext === 'mp4');
        if (!existing) {
            heightMap[h] = f;
        } else if (fIsH264 && !existingIsH264) {
            heightMap[h] = f;
        } else if ((fIsH264 === existingIsH264) && (f.tbr || 0) > (existing.tbr || 0)) {
            heightMap[h] = f;
        }
    }

    for (const [height, f] of Object.entries(heightMap)) {
        const h = parseInt(height);
        const sizeBytes = (f.filesize || f.filesize_approx || 0) + (bestAudio?.filesize || bestAudio?.filesize_approx || 0);
        downloadable_formats.push({
            format_id: f.format_id,
            audio_format_id: bestAudio?.format_id || null,
            ext: 'mp4',
            filesize_approx: sizeBytes || null,
            filesize_string: sizeBytes ? formatBytes(sizeBytes) : 'Unknown',
            url: null,
            height: h,
            width: f.width || null,
            fps: f.fps || 30,
            quality_note: f.format_note || `${h}p`,
            resolution: f.width ? `${f.width}x${h}` : `${h}p`,
            type: 'video_with_audio',
            has_audio: true,
            needs_merge: true,
            quality_order: h
        });
    }

    // Combined/muxed formats (e.g. 360p with audio already baked in)
    for (const f of combined) {
        const h = f.height || 0;
        if (heightMap[h]) continue; // skip if we have a better split version
        downloadable_formats.push({
            format_id: f.format_id,
            audio_format_id: null,
            ext: f.ext || 'mp4',
            filesize_approx: f.filesize || f.filesize_approx || null,
            filesize_string: formatBytes(f.filesize || f.filesize_approx),
            url: f.url || null,
            height: h,
            width: f.width || null,
            fps: f.fps || 30,
            quality_note: f.format_note || `${h}p`,
            resolution: f.width ? `${f.width}x${h}` : `${h}p`,
            type: 'video_with_audio',
            has_audio: true,
            needs_merge: false,
            quality_order: h
        });
    }

    // Audio-only formats — emit both native (m4a) and mp3 variants
    const audioBitratesSeen = new Set();
    for (const f of audioOnly.sort((a, b) => (b.abr || 0) - (a.abr || 0))) {
        const abr = Math.round(f.abr || 0);
        if (audioBitratesSeen.has(abr)) continue;
        audioBitratesSeen.add(abr);
        const isM4A = f.ext === 'm4a' || f.acodec?.startsWith('mp4a');
        audio_formats.push({
            format_id: f.format_id,
            ext: isM4A ? 'm4a' : 'webm',
            abr,
            filesize: f.filesize || f.filesize_approx || null,
            filesize_string: formatBytes(f.filesize || f.filesize_approx),
            url: null,
            quality_note: `${abr}kbps (M4A)`,
            type: 'audio_only',
            has_audio: true,
            has_video: false,
            needs_merge: false,
            quality_order: abr * 2
        });
        audio_formats.push({
            format_id: `${f.format_id}_mp3`,
            ext: 'mp3',
            abr,
            filesize: null,
            filesize_string: null,
            url: null,
            quality_note: `${abr}kbps (MP3)`,
            type: 'audio_only',
            has_audio: true,
            has_video: false,
            needs_merge: false,
            quality_order: abr * 2 - 1
        });
    }

    downloadable_formats.sort((a, b) => b.quality_order - a.quality_order);
    audio_formats.sort((a, b) => b.quality_order - a.quality_order);

    // Best thumbnail
    const thumbs = (info.thumbnails || []).filter(t => t.url);
    const thumbnail_url = thumbs[thumbs.length - 1]?.url || info.thumbnail || null;

    return {
        title: info.title || 'N/A',
        thumbnail_url,
        uploader: info.uploader || info.channel || 'N/A',
        duration_string: formatDuration(info.duration),
        view_count: info.view_count || null,
        like_count: info.like_count || null,
        upload_date: info.upload_date || null,
        description: (info.description || '').substring(0, 300),
        original_url: videoUrl,
        platform: 'YouTube',
        downloadable_formats,
        audio_formats,
        thumbnails: thumbs
    };
}

// ─── Download via yt-dlp stdout pipe ─────────────────────────────────────────

export function downloadViaYtDlp(pageUrl, videoItag, audioItag, res) {
    return new Promise((resolve, reject) => {
        const wantMp3 = audioItag?.endsWith('_mp3');
        const cleanAudioItag = audioItag?.replace('_mp3', '');

        let formatSelector;
        if (videoItag && cleanAudioItag) {
            formatSelector = `${videoItag}+${cleanAudioItag}/bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]`;
        } else if (cleanAudioItag) {
            formatSelector = `${cleanAudioItag}/bestaudio[ext=m4a]`;
        } else {
            formatSelector = `${videoItag}/bestvideo[ext=mp4]`;
        }

        const args = [
            '-f', formatSelector,
            '--ffmpeg-location', ffmpegBin,
            '--no-playlist',
            '-o', '-',
            '--quiet',
            ...getYtDlpAuthArgs(true)   // download: android client helps avoid bot checks
        ];

        if (wantMp3) {
            args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
        } else if (!videoItag) {
            args.push('--extract-audio');
        } else {
            args.push('--merge-output-format', 'mp4');
        }

        args.push(pageUrl);
        console.log(`[mediaHelper] yt-dlp: -f "${formatSelector}" ${pageUrl}`);

        const proc = spawn(ytdlpBin, args);
        let stderrBuf = '';
        proc.stderr.on('data', d => { stderrBuf += d.toString(); });
        proc.stdout.pipe(res);
        proc.stdout.on('error', err => console.error('[mediaHelper] stdout error:', err.message));

        proc.on('close', code => {
            console.log(`[mediaHelper] yt-dlp exited: ${code}`);
            if (stderrBuf) console.log('[mediaHelper] stderr:', stderrBuf.substring(0, 500));
            if (code === 0 || code === null) resolve();
            else {
                const e = new Error(`yt-dlp failed (${code}): ${stderrBuf.substring(0, 200)}`);
                if (!res.headersSent) reject(e); else resolve();
            }
        });

        proc.on('error', err => { console.error('[mediaHelper] spawn error:', err.message); reject(err); });
    });
}

// ─── Instagram via instagram-url-direct ──────────────────────────────────────

async function getInstagramInfo(videoUrl) {
    console.log('[mediaHelper] Fetching Instagram info via instagram-url-direct');

    const result = await instagramGetUrl(videoUrl);
    if (!result?.url_list?.length) throw new Error('No downloadable media found for this Instagram URL');

    const downloadable_formats = result.url_list.map((mediaUrl, index) => {
        const isImage = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(mediaUrl) || mediaUrl.includes('/e15/') || mediaUrl.includes('/e35/');
        const ext = isImage ? 'jpg' : 'mp4';
        const label = isImage ? 'Image' : 'Video';
        return {
            format_id: `ig_${index}`,
            ext,
            filesize: null,
            filesize_string: null,
            url: mediaUrl,
            height: 0, width: 0, fps: null,
            quality_note: result.url_list.length > 1 ? `${label} ${index + 1}` : `Best Quality ${label}`,
            resolution: 'Best Available',
            type: isImage ? 'image' : 'video_with_audio',
            has_audio: !isImage,
            needs_merge: false,
            quality_order: result.url_list.length - index
        };
    });

    downloadable_formats.sort((a, b) => b.quality_order - a.quality_order);

    return {
        title: result.media_details?.caption?.text?.substring(0, 100) || 'Instagram Post',
        thumbnail_url: result.media_details?.display_url || null,
        uploader: result.media_details?.owner?.username || 'Instagram User',
        duration_string: 'N/A',
        view_count: result.media_details?.video_view_count || null,
        like_count: result.media_details?.edge_media_preview_like?.count || null,
        upload_date: null,
        description: result.media_details?.caption?.text?.substring(0, 300) || '',
        original_url: videoUrl,
        platform: 'Instagram',
        downloadable_formats,
        audio_formats: [],
        thumbnails: result.media_details?.display_url ? [{ url: result.media_details.display_url }] : []
    };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const getVideoInfo = async (videoUrl) => {
    const isYouTube = videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be');
    const isInstagram = videoUrl.includes('instagram.com');
    try {
        if (isYouTube) return await getYouTubeInfo(videoUrl);
        if (isInstagram) return await getInstagramInfo(videoUrl);
        throw new Error('Unsupported platform. Only YouTube and Instagram are supported.');
    } catch (error) {
        console.error('[mediaHelper] Error:', error.message);
        throw new Error(`Failed to fetch video info: ${error.message}`);
    }
};
