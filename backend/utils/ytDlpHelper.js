import * as ytdlpWrapAll from 'yt-dlp-wrap';

let ActualYTDlpWrapConstructor;

if (ytdlpWrapAll.default && typeof ytdlpWrapAll.default.default === 'function') {
    ActualYTDlpWrapConstructor = ytdlpWrapAll.default.default;
} else if (typeof ytdlpWrapAll.default === 'function') {
    ActualYTDlpWrapConstructor = ytdlpWrapAll.default;
} else if (typeof ytdlpWrapAll === 'function') {
    ActualYTDlpWrapConstructor = ytdlpWrapAll;
}

import fs from 'fs';
import path from 'path';

let ytDlpWrapInstance;

export const ytdlpPath = path.join(process.cwd(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

try {
    if (!fs.existsSync(ytdlpPath)) {
        console.log('[ytDlpHelper] Downloading latest yt-dlp binary...');
        
        // Wait at most 10 seconds for wrap to download
        const downloadPromise = ActualYTDlpWrapConstructor.downloadFromGithub(ytdlpPath);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Download timeout')), 10000));
        
        try {
            await Promise.race([downloadPromise, timeoutPromise]);
            console.log('[ytDlpHelper] Successfully downloaded latest yt-dlp binary via wrap.');
        } catch (downloadError) {
            console.log(`[ytDlpHelper] Wrap download failed or timed out: ${downloadError.message}. Trying direct download...`);
            
            // Fallback direct download
            const https = await import('https');
            const releaseUrl = process.platform === 'win32' 
                ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
                : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
                
            await new Promise((resolve, reject) => {
                https.get(releaseUrl, (res) => {
                    if (res.statusCode === 301 || res.statusCode === 302) {
                        https.get(res.headers.location, (redirectRes) => {
                            const fileStream = fs.createWriteStream(ytdlpPath);
                            redirectRes.pipe(fileStream);
                            fileStream.on('finish', () => {
                                fileStream.close();
                                if (process.platform !== 'win32') {
                                    fs.chmodSync(ytdlpPath, '755');
                                }
                                resolve();
                            });
                        }).on('error', reject);
                    } else {
                        reject(new Error(`Failed to download: ${res.statusCode}`));
                    }
                }).on('error', reject);
            });
            console.log('[ytDlpHelper] Successfully downloaded via direct fallback.');
        }
    } else {
        console.log('[ytDlpHelper] Using existing yt-dlp binary.');
    }
    ytDlpWrapInstance = new ActualYTDlpWrapConstructor(ytdlpPath);
    console.log('[ytDlpHelper] YTDlpWrap instance created successfully.');
} catch (error) {
    console.error("[ytDlpHelper] Failed to download or initialize YTDlpWrap, falling back:", error);
    try {
        ytDlpWrapInstance = new ActualYTDlpWrapConstructor();
    } catch (fallbackError) {
        console.error("[ytDlpHelper] Fallback also failed:", fallbackError);
    }
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes) return null;
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

export const getVideoInfo = async (videoUrl) => {
    if (!ytDlpWrapInstance) {
        throw new Error("yt-dlp service not available");
    }

    console.log(`[ytDlpHelper] Fetching info for: ${videoUrl}`);

    try {
        // Extract platform info
        const isInstagram = videoUrl.includes('instagram.com');
        const isYouTube = videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be');

        const videoDetails = {
            title: '',
            thumbnail_url: null,
            uploader: '',
            duration_string: '',
            view_count: null,
            like_count: null,
            upload_date: null,
            description: '',
            original_url: videoUrl,
            platform: isInstagram ? 'Instagram' : isYouTube ? 'YouTube' : 'Other',
            downloadable_formats: [],
            audio_formats: [],
            thumbnails: [],
        };

        if (isYouTube) {
            console.log('[ytDlpHelper] Getting all YouTube formats');
            
            const options = {
                dumpSingleJson: true,
                noCheckCertificates: true,
                addHeader: ['User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36']
            };

            const metadata = await ytDlpWrapInstance.getVideoInfo(videoUrl, options);
            
            // Fill video details from metadata
            videoDetails.title = metadata.title || 'N/A';
            videoDetails.thumbnail_url = metadata.thumbnail || null;
            videoDetails.uploader = metadata.uploader || metadata.channel || 'N/A';
            videoDetails.duration_string = metadata.duration_string || 'N/A';
            videoDetails.view_count = metadata.view_count || null;
            videoDetails.like_count = metadata.like_count || null;
            videoDetails.upload_date = metadata.upload_date || null;
            videoDetails.description = metadata.description?.substring(0, 200) || 'No description';
            videoDetails.thumbnails = metadata.thumbnails || [];

            if (metadata.formats && Array.isArray(metadata.formats)) {
                // Determine best audio format for merging if necessary
                const bestAudio = metadata.formats
                    .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
                    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

                metadata.formats.forEach(f => {
                    const hasVideo = f.vcodec !== 'none';
                    const hasAudio = f.acodec !== 'none';
                    const height = parseInt(f.height || 0, 10);
                    
                    if (hasVideo && !hasAudio && bestAudio) {
                        // Video-only format that needs merging with audio
                        // We only provide standard resolutions to avoid clutter
                        if ([144, 240, 360, 480, 720, 1080, 1440, 2160].includes(height) || height > 2160) {
                            videoDetails.downloadable_formats.push({
                                format_id: f.format_id, // we will merge this with best audio later
                                audio_format_id: bestAudio.format_id, // include the audio format ID to use for merging
                                ext: 'mp4', // Merged output will be mp4
                                filesize_approx: f.filesize_approx || f.filesize,
                                filesize_string: formatBytes((f.filesize_approx || f.filesize || 0) + (bestAudio.filesize || bestAudio.filesize_approx || 0)),
                                url: f.url,
                                height: height,
                                width: parseInt(f.width || 0, 10),
                                fps: f.fps || null,
                                quality_note: `${height}p (Video + Audio)`,
                                resolution: `${f.width || '?'}x${height}`,
                                type: 'video_with_audio',
                                has_audio: true,
                                needs_merge: true,
                                quality_order: height
                            });
                        }
                    } else if (hasVideo && hasAudio) {
                        // Pre-merged video+audio (typically 720p or lower on YouTube)
                        videoDetails.downloadable_formats.push({
                            format_id: f.format_id,
                            ext: f.ext || 'mp4',
                            filesize: f.filesize || f.filesize_approx,
                            filesize_string: formatBytes(f.filesize || f.filesize_approx),
                            url: f.url,
                            height: height,
                            width: parseInt(f.width || 0, 10),
                            fps: f.fps || null,
                            quality_note: `${height}p (Native Video + Audio)`,
                            resolution: `${f.width || '?'}x${height}`,
                            type: 'video_with_audio',
                            has_audio: true,
                            needs_merge: false,
                            quality_order: height
                        });
                    } else if (!hasVideo && hasAudio) {
                        // Audio only (MP3/M4A)
                        videoDetails.audio_formats.push({
                            format_id: f.format_id,
                            ext: f.ext === 'm4a' ? 'm4a' : 'mp3',
                            abr: f.abr || 0,
                            filesize: f.filesize || f.filesize_approx,
                            filesize_string: formatBytes(f.filesize || f.filesize_approx),
                            url: f.url,
                            quality_note: `Audio Only (${f.abr ? f.abr + 'kbps' : f.ext})`,
                            type: 'audio_only',
                            has_audio: true,
                            has_video: false,
                            quality_order: f.abr || 0
                        });
                    }
                });
            }

        } else {
            // For Instagram and others
            const options = {
                dumpSingleJson: true,
                noCheckCertificates: true,
                addHeader: ['User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36']
            };

            const metadata = await ytDlpWrapInstance.getVideoInfo(videoUrl, options);
            
            // Fill video details
            videoDetails.title = metadata.title || 'N/A';
            videoDetails.thumbnail_url = metadata.thumbnail || null;
            videoDetails.uploader = metadata.uploader || metadata.channel || 'N/A';
            videoDetails.duration_string = metadata.duration_string || 'N/A';
            videoDetails.view_count = metadata.view_count || null;
            videoDetails.like_count = metadata.like_count || null;
            videoDetails.upload_date = metadata.upload_date || null;
            videoDetails.description = metadata.description?.substring(0, 200) || 'No description';
            videoDetails.thumbnails = metadata.thumbnails || [];

            if (metadata.formats && Array.isArray(metadata.formats)) {
                 metadata.formats.forEach(f => {
                    const hasVideo = f.vcodec !== 'none';
                    const hasAudio = f.acodec !== 'none';
                    const height = parseInt(f.height || 0, 10);

                    if (hasVideo) {
                        videoDetails.downloadable_formats.push({
                            format_id: f.format_id,
                            ext: f.ext || 'mp4',
                            filesize: f.filesize || f.filesize_approx || null,
                            filesize_string: formatBytes(f.filesize || f.filesize_approx),
                            url: f.url,
                            height: height,
                            width: parseInt(f.width || 0, 10),
                            fps: f.fps || null,
                            quality_note: height ? `${height}p` : 'Video',
                            resolution: height ? `${f.width}x${height}` : 'Available',
                            type: hasAudio ? 'video_with_audio' : 'video_only',
                            has_audio: hasAudio,
                            quality_order: height || 999,
                        });
                    } else if (hasAudio) {
                        videoDetails.audio_formats.push({
                            format_id: f.format_id,
                            ext: 'mp3',
                            abr: f.abr || 0,
                            filesize: f.filesize || f.filesize_approx,
                            filesize_string: formatBytes(f.filesize || f.filesize_approx),
                            url: f.url,
                            quality_note: `Audio Only`,
                            type: 'audio_only',
                            has_audio: true,
                            has_video: false,
                            quality_order: f.abr || 0
                        });
                    }
                 });
            } else if (metadata.url && metadata.ext) {
                // Fallback for simple direct link (Instagram old behavior)
                const height = parseInt(metadata.height || 0, 10);
                videoDetails.downloadable_formats.push({
                    format_id: metadata.format_id || 'best',
                    ext: metadata.ext || 'mp4',
                    filesize: metadata.filesize || metadata.filesize_approx || null,
                    filesize_string: formatBytes(metadata.filesize || metadata.filesize_approx),
                    url: metadata.url,
                    height: height,
                    width: parseInt(metadata.width || 0, 10),
                    fps: metadata.fps || null,
                    quality_note: height ? `${height}p (Video + Audio)` : 'Best Quality',
                    resolution: height ? `${metadata.width}x${height}` : 'Best Available',
                    type: 'video_with_audio',
                    has_audio: true,
                    quality_order: height || 999,
                });
            }
        }

        // Deduplicate and Sort formats by quality (highest first)
        
        // Helper to dedupe
        const dedupe = (arr, keyFn) => {
            const seen = new Set();
            return arr.filter(item => {
                const k = keyFn(item);
                return seen.has(k) ? false : seen.add(k);
            });
        };

        videoDetails.downloadable_formats = dedupe(videoDetails.downloadable_formats, f => Math.abs(f.height || f.quality_order));
        videoDetails.audio_formats = dedupe(videoDetails.audio_formats, f => Math.abs(f.abr || f.quality_order));

        videoDetails.downloadable_formats.sort((a, b) => (b.quality_order || 0) - (a.quality_order || 0));
        videoDetails.audio_formats.sort((a, b) => (b.quality_order || 0) - (a.quality_order || 0));

        if (videoDetails.downloadable_formats.length === 0 && videoDetails.audio_formats.length === 0) {
            throw new Error('No video+audio formats available.');
        }

        console.log(`[ytDlpHelper] SUCCESS: ${videoDetails.downloadable_formats.length} video+audio formats ready`);
        videoDetails.downloadable_formats.forEach((format, i) => {
            console.log(`[ytDlpHelper] Format ${i+1}: ${format.quality_note} - ${format.filesize_string || 'Unknown size'}`);
        });

        return videoDetails;

    } catch (error) {
        console.error(`[ytDlpHelper] Error:`, error.message);
        throw new Error(`Failed to get video+audio formats: ${error.message}`);
    }
};
