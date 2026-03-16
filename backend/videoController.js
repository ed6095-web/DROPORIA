import { getVideoInfo as fetchVideoDetailsFromHelper, downloadViaYtDlp } from './utils/mediaHelper.js';
import axios from 'axios';
import stream from 'stream';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);

export const getVideoInfo = async (req, res, next) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'Video URL is required', code: 'MISSING_URL' });

    console.log(`[Controller] Fetching info for: ${url}`);
    try {
        const details = await fetchVideoDetailsFromHelper(url);
        console.log(`[Controller] SUCCESS - ${details.downloadable_formats?.length || 0} video formats`);
        res.status(200).json({ success: true, data: details, timestamp: new Date().toISOString() });
    } catch (error) {
        console.error('[Controller] Error:', error.message);
        res.status(500).json({ success: false, error: error.message, code: 'FETCH_ERROR' });
    }
};

/**
 * Merge/stream download via yt-dlp piped to response.
 * yt-dlp downloads + merges the video+audio internally and pipes mp4 to stdout.
 */
export const downloadMergedVideo = async (req, res, next) => {
    const { url: pageUrl, video_format, audio_format, filename } = req.query;

    if (!pageUrl || !filename) {
        return res.status(400).json({ success: false, error: 'URL and filename are required', code: 'MISSING_PARAMS' });
    }
    if (!video_format && !audio_format) {
        return res.status(400).json({ success: false, error: 'At least one format ID is required', code: 'MISSING_PARAMS' });
    }

    console.log(`[MergeController] Download: ${filename} | video=${video_format || '-'} audio=${audio_format || '-'}`);

    try {
        const isAudioOnly = !video_format && audio_format;
        const isMp3 = filename.endsWith('.mp3');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        if (isAudioOnly) {
            res.setHeader('Content-Type', isMp3 ? 'audio/mpeg' : 'audio/mp4');
        } else {
            res.setHeader('Content-Type', 'video/mp4');
        }

        await downloadViaYtDlp(pageUrl, video_format, audio_format, res);
        console.log(`[MergeController] Done: ${filename}`);
    } catch (error) {
        console.error('[MergeController] Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Download failed. Please try again.', code: 'MERGE_ERROR' });
        }
    }
};

export const downloadVideoViaProxy = async (req, res, next) => {
    const { url: mediaUrl, filename, mimeTypeFromClient } = req.query;

    if (!mediaUrl || !filename || mediaUrl === 'undefined' || filename === 'undefined') {
        return res.status(400).json({ success: false, error: 'Media URL and filename are required', code: 'MISSING_PARAMS' });
    }

    console.log(`[ProxyController] Downloading: ${filename}`);

    try {
        const response = await axios({
            method: 'GET',
            url: mediaUrl,
            responseType: 'stream',
            timeout: 900000,
            maxRedirects: 10,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.instagram.com/',
                'Origin': 'https://www.instagram.com'
            }
        });

        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Content-Type', mimeTypeFromClient || response.headers['content-type'] || 'application/octet-stream');
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);

        await pipeline(response.data, res);
        console.log(`[ProxyController] Done: ${filename}`);
    } catch (error) {
        console.error('[ProxyController] Error:', error.message);
        if (!res.headersSent) {
            res.status(502).json({ success: false, error: 'Download failed. Try again.', code: 'DOWNLOAD_ERROR' });
        }
    }
};

export const healthCheck = async (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Droporia API is healthy! 🚀',
        timestamp: new Date().toISOString(),
        version: '2.0.0'
    });
};
