import express from 'express';
import { getVideoInfo, downloadVideoViaProxy, downloadMergedVideo, healthCheck } from './videoController.js';

const router = express.Router();

// Video information endpoint
router.post('/video-info', getVideoInfo);

// Download proxy endpoint (for pre-combined formats)
router.get('/download-proxy', downloadVideoViaProxy);

// NEW: Download merge endpoint (for video+audio merging)
router.get('/download-merge', downloadMergedVideo);

// Health check endpoint
router.get('/health', healthCheck);

export default router;
