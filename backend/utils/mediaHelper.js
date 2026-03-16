import play from 'play-dl';
import { instagramGetUrl } from 'instagram-url-direct';
import { spawn } from 'child_process';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// yt-dlp binary path
const ytdlpBin = path.join(process.cwd(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

// ffmpeg-static binary path (yt-dlp uses this to merge streams)
const ffmpegBin = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes, decimals = 2) {
    if (!bytes) return null;
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatDuration(totalSecs) {
    if (!totalSecs) return 'N/A';
    const secs = Math.floor(totalSecs);
    const hours = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (hours > 0) return `${hours}:${String(mins).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${mins}:${String(s).padStart(2,'0')}`;
}

// ─── YouTube via play-dl (metadata only) ─────────────────────────────────────

async function getYouTubeInfo(videoUrl) {
    console.log('[mediaHelper] Fetching YouTube metadata via play-dl');
    const info = await play.video_info(videoUrl);
    const details = info.video_details;
    const formats = info.format;

    const premerged = formats.filter(f => f.mimeType?.startsWith('video/') && f.audioQuality);
    const videoOnly = formats.filter(f => f.mimeType?.startsWith('video/') && !f.audioQuality);
    const audioOnly = formats.filter(f => f.mimeType?.startsWith('audio/') && !f.isDrc && !f.isVb);

    const bestAudio = audioOnly
        .filter(f => f.container === 'mp4' || f.mimeType?.includes('mp4'))
        .sort((a, b) => (b.averageBitrate || 0) - (a.averageBitrate || 0))[0]
        || audioOnly.sort((a, b) => (b.averageBitrate || 0) - (a.averageBitrate || 0))[0];

    const downloadable_formats = [];
    const audio_formats = [];

    // Dedupe video-only by height — prefer avc1/mp4
    const heightMap = {};
    for (const f of videoOnly) {
        const h = f.height;
        if (!h) continue;
        const existing = heightMap[h];
        const fIsMP4 = f.mimeType?.includes('mp4') && f.mimeType?.includes('avc1');
        const existingIsMP4 = existing && existing.mimeType?.includes('mp4') && existing.mimeType?.includes('avc1');
        if (!existing) {
            heightMap[h] = f;
        } else if (fIsMP4 && !existingIsMP4) {
            heightMap[h] = f;
        } else if ((fIsMP4 === existingIsMP4) && (f.averageBitrate || 0) > (existing.averageBitrate || 0)) {
            heightMap[h] = f;
        }
    }

    for (const [height, f] of Object.entries(heightMap)) {
        const h = parseInt(height);
        const sizeBytes = parseInt(f.contentLength || 0) + parseInt(bestAudio?.contentLength || 0);
        downloadable_formats.push({
            format_id: String(f.itag),
            audio_format_id: bestAudio ? String(bestAudio.itag) : null,
            ext: 'mp4',
            filesize_approx: sizeBytes || null,
            filesize_string: sizeBytes ? formatBytes(sizeBytes) : 'Unknown',
            url: null, // resolved at download time via yt-dlp
            height: h,
            width: f.width || null,
            fps: f.fps || 30,
            quality_note: f.qualityLabel || `${h}p`,
            resolution: f.width ? `${f.width}x${h}` : `${h}p`,
            type: 'video_with_audio',
            has_audio: true,
            needs_merge: true,
            quality_order: h
        });
    }

    // Pre-merged formats (360p etc.) — these have direct URLs from play-dl
    for (const f of premerged) {
        const h = f.height || 0;
        if (heightMap[h]) continue;
        downloadable_formats.push({
            format_id: String(f.itag),
            audio_format_id: null,
            ext: 'mp4',
            filesize_approx: parseInt(f.contentLength || 0) || null,
            filesize_string: formatBytes(parseInt(f.contentLength || 0)),
            url: f.url || null,
            height: h,
            width: f.width || null,
            fps: f.fps || 30,
            quality_note: f.qualityLabel || `${h}p`,
            resolution: f.width ? `${f.width}x${h}` : `${h}p`,
            type: 'video_with_audio',
            has_audio: true,
            needs_merge: false,
            quality_order: h
        });
    }

    // Audio-only formats — emit both m4a and mp3 variants
    const audioBitrates = new Set();
    for (const f of audioOnly) {
        const abr = Math.round((f.averageBitrate || 0) / 1000);
        if (audioBitrates.has(abr)) continue;
        audioBitrates.add(abr);
        const isM4A = f.container === 'mp4' || f.mimeType?.includes('mp4');
        // M4A variant
        audio_formats.push({
            format_id: String(f.itag),
            ext: isM4A ? 'm4a' : 'webm',
            abr: abr,
            filesize: parseInt(f.contentLength || 0) || null,
            filesize_string: formatBytes(parseInt(f.contentLength || 0)),
            url: null,
            quality_note: `${abr}kbps (M4A)`,
            type: 'audio_only',
            has_audio: true,
            has_video: false,
            needs_merge: false,
            quality_order: abr * 2 // *2 so mp3 (abr*2-1) sorts just below
        });
        // MP3 variant (same itag, re-encoded by yt-dlp at download time)
        audio_formats.push({
            format_id: `${f.itag}_mp3`,
            ext: 'mp3',
            abr: abr,
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

    return {
        title: details.title || 'N/A',
        thumbnail_url: details.thumbnails?.[details.thumbnails.length - 1]?.url || null,
        uploader: details.channel?.name || 'N/A',
        duration_string: formatDuration(details.durationInSec),
        view_count: details.views || null,
        like_count: null,
        upload_date: details.uploadedAt || null,
        description: (details.description || '').substring(0, 300),
        original_url: videoUrl,
        platform: 'YouTube',
        downloadable_formats,
        audio_formats,
        thumbnails: details.thumbnails || []
    };
}

// ─── Download via yt-dlp piped to HTTP response ───────────────────────────────

/**
 * Use yt-dlp to download a YouTube video and stream it directly to an Express response.
 * yt-dlp handles the downloading + merging internally using the bundled ffmpeg-static.
 *
 * @param {string} pageUrl     - YouTube page URL
 * @param {string} videoItag   - itag for video stream (null for audio-only)
 * @param {string} audioItag   - itag for audio stream
 * @param {object} res         - Express Response object
 * @returns {Promise<void>}
 */
export function downloadViaYtDlp(pageUrl, videoItag, audioItag, res) {
    return new Promise((resolve, reject) => {
        // Strip _mp3 suffix if present — it means convert to mp3 after download
        const wantMp3 = audioItag?.endsWith('_mp3');
        const cleanAudioItag = audioItag?.replace('_mp3', '');

        // Build format selector
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
            '--quiet'
        ];

        if (wantMp3) {
            // Re-encode to mp3 via ffmpeg
            args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
        } else if (!videoItag) {
            // Audio-only non-mp3: keep original container
            args.push('--extract-audio');
        } else {
            // Video+audio merge
            args.push('--merge-output-format', 'mp4');
        }

        args.push(pageUrl);

        console.log(`[mediaHelper] yt-dlp args: -f "${formatSelector}" -o - ${pageUrl}`);
        const proc = spawn(ytdlpBin, args);

        let stderrBuf = '';
        proc.stderr.on('data', d => {
            stderrBuf += d.toString();
        });

        proc.stdout.pipe(res);

        proc.stdout.on('error', err => {
            console.error('[mediaHelper] stdout error:', err.message);
        });

        proc.on('close', code => {
            console.log(`[mediaHelper] yt-dlp exited with code ${code}`);
            if (stderrBuf) console.log('[mediaHelper] yt-dlp stderr:', stderrBuf.substring(0, 500));
            if (code === 0 || code === null) {
                resolve();
            } else {
                const err = new Error(`yt-dlp failed (code ${code}): ${stderrBuf.substring(0, 300)}`);
                if (!res.headersSent) reject(err);
                else resolve(); // headers sent, stream was partially written
            }
        });

        proc.on('error', err => {
            console.error('[mediaHelper] spawn error:', err.message);
            reject(err);
        });
    });
}

// ─── Instagram via instagram-url-direct ──────────────────────────────────────

async function getInstagramInfo(videoUrl) {
    console.log('[mediaHelper] Fetching Instagram info via instagram-url-direct');

    const result = await instagramGetUrl(videoUrl);

    if (!result || !result.url_list || result.url_list.length === 0) {
        throw new Error('No downloadable media found for this Instagram URL');
    }

    const downloadable_formats = result.url_list.map((mediaUrl, index) => {
        // Detect if it's an image URL (Instagram CDN images contain /e15/ or end in .jpg etc.)
        const isImage = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(mediaUrl) || mediaUrl.includes('/e15/') || mediaUrl.includes('/e35/');
        const ext = isImage ? 'jpg' : 'mp4';
        const label = isImage ? 'Image' : 'Video';
        return {
            format_id: `ig_${index}`,
            ext,
            filesize: null,
            filesize_string: null,
            url: mediaUrl,
            height: 0,
            width: 0,
            fps: null,
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
        title: result.media_details?.caption?.text?.substring(0, 100) || 'Instagram Video',
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
