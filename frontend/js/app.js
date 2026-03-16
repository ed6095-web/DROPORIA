class DroporiaApp {
    constructor() {
        this.API_BASE = (window.DROPORIA_API_URL || 'http://localhost:3000') + '/api';
        this.currentVideoData = null;
        this.downloadCount = parseInt(localStorage.getItem('downloadCount') || '0');
        this.theme = localStorage.getItem('theme') || 'light';
        this.isLoading = false;
        
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupTheme();
        this.updateDownloadCount();
        this.setupAnimations();
        this.checkAPIHealth();
        
        await this.sleep(500);
        this.showWelcomeAnimation();
    }

    debugLog(message, data = null) {
        console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`);
        if (data) {
            console.log('[DEBUG] Data:', data);
        }
    }

    setupEventListeners() {
        const videoUrlInput = document.getElementById('videoUrlInput');
        const fetchInfoButton = document.getElementById('fetchInfoButton');
        const themeToggle = document.getElementById('theme-toggle');
        const closeModalButton = document.getElementById('closeModalButton');
        const previewModal = document.getElementById('previewModal');
        const exampleButtons = document.querySelectorAll('.example-btn');
        const retryButton = document.getElementById('retry-button');

        if (videoUrlInput) {
            videoUrlInput.addEventListener('input', (e) => this.handleUrlInput(e));
            videoUrlInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleVideoFetch();
            });
            videoUrlInput.addEventListener('paste', (e) => {
                setTimeout(() => this.validateAndFormatUrl(), 100);
            });
        }

        if (fetchInfoButton) {
            fetchInfoButton.addEventListener('click', () => this.handleVideoFetch());
        }

        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        if (closeModalButton) {
            closeModalButton.addEventListener('click', () => this.closeModal());
        }
        
        if (previewModal) {
            previewModal.addEventListener('click', (e) => {
                if (e.target === previewModal || e.target.classList.contains('modal-backdrop')) {
                    this.closeModal();
                }
            });
        }

        exampleButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const exampleUrl = e.target.dataset.url;
                if (exampleUrl) {
                    videoUrlInput.value = exampleUrl;
                    this.addInputAnimation(videoUrlInput);
                    this.validateAndFormatUrl();
                }
            });
        });

        if (retryButton) {
            retryButton.addEventListener('click', () => {
                this.hideError();
                this.handleVideoFetch();
            });
        }

        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
        
        const currentYearElement = document.getElementById('currentYear');
        if (currentYearElement) {
            currentYearElement.textContent = new Date().getFullYear();
        }
    }

    handleUrlInput(e) {
        const input = e.target;
        this.addInputAnimation(input);
        this.validateAndFormatUrl();
    }

    addInputAnimation(input) {
        input.style.transform = 'scale(1.02)';
        setTimeout(() => {
            input.style.transform = 'scale(1)';
        }, 150);
    }

    validateAndFormatUrl() {
        const input = document.getElementById('videoUrlInput');
        const url = input.value.trim();
        
        if (!url) return;

        try {
            new URL(url);
            input.style.borderColor = 'var(--success-color)';
            this.showToast('Valid URL detected!', 'success', 2000);
        } catch {
            if (url.length > 10) {
                input.style.borderColor = 'var(--error-color)';
            }
        }
        
        setTimeout(() => {
            input.style.borderColor = '';
        }, 2000);
    }

    async checkAPIHealth() {
        try {
            const response = await fetch(`${this.API_BASE}/health`);
            const data = await response.json();
            
            if (data.success) {
                this.showToast('Connected to Droporia API! 🚀', 'success', 3000);
            }
        } catch (error) {
            this.showToast('API connection failed. Please check if the server is running.', 'error', 5000);
        }
    }

    async handleVideoFetch() {
        if (this.isLoading) return;
        
        const urlInput = document.getElementById('videoUrlInput');
        const url = urlInput.value.trim();

        this.debugLog('Starting video fetch', { url });

        if (!url) {
            this.showToast('Please enter a video URL', 'warning');
            this.shakeElement(urlInput);
            return;
        }

        if (!this.isValidUrl(url)) {
            this.showToast('Please enter a valid URL', 'error');
            this.shakeElement(urlInput);
            return;
        }

        try {
            this.isLoading = true;
            this.showLoading('Fetching video information...');
            this.hideError();
            this.hideResults();

            this.debugLog('Making API request');

            const response = await fetch(`${this.API_BASE}/video-info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            this.debugLog('API response received', { 
                status: response.status, 
                ok: response.ok 
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to fetch video info');
            }

            this.currentVideoData = data.data;
            this.hideLoading();
            this.displayVideoResults(data.data);
            this.showToast('Video information loaded successfully! 🎉', 'success');
            
        } catch (error) {
            this.debugLog('Error in video fetch', { 
                error: error.message,
                stack: error.stack 
            });
            
            this.hideLoading();
            this.showError(error.message);
            this.showToast(error.message, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    displayVideoResults(videoData) {
        const resultsSection = document.getElementById('results-section');
        
        const html = `
            <div class="result-card glass-card" style="animation: slideInUp 0.6s var(--transition-bounce);">
                <div class="video-info">
                    <div class="thumbnail-container">
                        <img src="${videoData.thumbnail_url || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22200%22%3E%3Crect width=%22300%22 height=%22200%22 fill=%22%23334%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23aaa%22 font-size=%2220%22%3E▶%3C/text%3E%3C/svg%3E'}" 
                             alt="Video Thumbnail" 
                             class="video-thumbnail"
                             onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22200%22%3E%3Crect width=%22300%22 height=%22200%22 fill=%22%23334%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23aaa%22 font-size=%2220%22%3E▶%3C/text%3E%3C/svg%3E'">
                        <div class="thumbnail-overlay">
                            <i class="fas fa-play"></i>
                        </div>
                    </div>
                    <div class="video-details">
                        <h3>${this.escapeHtml(videoData.title)}</h3>
                        <div class="video-meta">
                            <div class="meta-item">
                                <i class="fas fa-user"></i>
                                <span>${this.escapeHtml(videoData.uploader)}</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-clock"></i>
                                <span>${videoData.duration_string || 'N/A'}</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-eye"></i>
                                <span>${this.formatNumber(videoData.view_count) || 'N/A'}</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-thumbs-up"></i>
                                <span>${this.formatNumber(videoData.like_count) || 'N/A'}</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-calendar"></i>
                                <span>${this.formatDate(videoData.upload_date) || 'N/A'}</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-globe"></i>
                                <span>${videoData.platform || 'Unknown'}</span>
                            </div>
                        </div>
                        <div class="video-description">
                            <p>${this.escapeHtml(videoData.description || 'No description available')}</p>
                        </div>
                    </div>
                </div>

                ${this.generateFormatsSection(videoData)}
            </div>
        `;

        resultsSection.innerHTML = html;
        resultsSection.classList.remove('hidden');
        
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        this.setupDownloadHandlers();
    }

    generateFormatsSection(videoData) {
        const videoFormats = videoData.downloadable_formats || [];
        const audioFormats = videoData.audio_formats || [];
        
        let html = '';

        if (videoFormats.length > 0) {
            html += `
                <div class="formats-section">
                    <div class="formats-header">
                        <h4>
                            <i class="fas fa-video"></i>
                            Video Formats (With Audio)
                            <span class="format-count">${videoFormats.length}</span>
                        </h4>
                    </div>
                    <div class="formats-grid">
                        ${videoFormats.map(format => this.generateFormatCard(format, 'video')).join('')}
                    </div>
                </div>
            `;
        }

        if (audioFormats.length > 0) {
            html += `
                <div class="formats-section">
                    <div class="formats-header">
                        <h4>
                            <i class="fas fa-music"></i>
                            Audio Only Formats
                            <span class="format-count">${audioFormats.length}</span>
                        </h4>
                    </div>
                    <div class="formats-grid">
                        ${audioFormats.map(format => this.generateFormatCard(format, 'audio')).join('')}
                    </div>
                </div>
            `;
        }

        return html;
    }

    generateFormatCard(format, type) {
        const isVideo = type === 'video';
        const icon = isVideo ? 'fa-video' : 'fa-music';
        const filename = this.generateFilename(format, isVideo);
        
        // Create proper download URL based on format type
        let downloadUrl;
        if (format.needs_merge && format.format_id && format.audio_format_id) {
            // Video-only adaptive format: merge video + audio streams via ffmpeg
            downloadUrl = `${this.API_BASE}/download-merge?url=${encodeURIComponent(this.currentVideoData.original_url)}&video_format=${encodeURIComponent(format.format_id)}&audio_format=${encodeURIComponent(format.audio_format_id)}&filename=${encodeURIComponent(filename)}`;
        } else if (format.type === 'audio_only' || (!format.url && format.format_id)) {
            // Audio-only adaptive format (no direct URL): stream via merge endpoint with just audio_format
            downloadUrl = `${this.API_BASE}/download-merge?url=${encodeURIComponent(this.currentVideoData.original_url)}&audio_format=${encodeURIComponent(format.format_id)}&filename=${encodeURIComponent(filename)}`;
        } else if (format.url) {
            // Pre-merged or direct URL (e.g., Instagram CDN, YouTube 360p native): use proxy
            downloadUrl = `${this.API_BASE}/download-proxy?url=${encodeURIComponent(format.url)}&filename=${encodeURIComponent(filename)}&mimeTypeFromClient=${encodeURIComponent(format.mime_type || '')}`;
        } else {
            // Fallback: shouldn't happen, but use merge endpoint
            downloadUrl = `${this.API_BASE}/download-merge?url=${encodeURIComponent(this.currentVideoData.original_url)}&video_format=${encodeURIComponent(format.format_id)}&filename=${encodeURIComponent(filename)}`;
        }
        
        return `
            <div class="format-card" data-format="${format.format_id}">
                <div class="format-header">
                    <div class="format-quality">
                        <i class="fas ${icon}"></i>
                        ${format.quality_note || 'Unknown'}
                    </div>
                    <div class="format-type">${format.ext?.toUpperCase() || 'N/A'}</div>
                </div>
                
                <div class="format-details">
                    <div class="format-detail">
                        <label>Resolution</label>
                        <span>${format.resolution || 'N/A'}</span>
                    </div>
                    <div class="format-detail">
                        <label>File Size</label>
                        <span>${format.filesize_string || 'Unknown'}</span>
                    </div>
                    <div class="format-detail">
                        <label>Quality</label>
                        <span>${format.has_audio ? 'Video + Audio ✓' : (isVideo ? 'Video Only' : 'Audio Only')}</span>
                    </div>
                    <div class="format-detail">
                        <label>Format</label>
                        <span>${format.vcodec && format.vcodec !== 'none' ? format.vcodec : format.acodec || 'N/A'}</span>
                    </div>
                </div>
                
                <div class="format-actions">
                    <button class="preview-btn" 
                            data-format-id="${format.format_id}"
                            data-format-url="${this.escapeHtml(format.url)}"
                            data-format-type="${type}"
                            title="Preview this format">
                        <i class="fas fa-play"></i>
                        Preview
                    </button>
                    <a href="${downloadUrl}" 
                       class="download-btn" 
                       data-filename="${this.escapeHtml(filename)}"
                       title="Download this format">
                        <i class="fas fa-download"></i>
                        Download
                    </a>
                </div>
            </div>
        `;
    }

    setupDownloadHandlers() {
        const downloadButtons = document.querySelectorAll('.download-btn');
        downloadButtons.forEach(btn => {
            btn.addEventListener('click', (e) => this.handleDownload(e));
        });
        
        const previewButtons = document.querySelectorAll('.preview-btn');
        previewButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const formatId = e.target.closest('.preview-btn').dataset.formatId;
                const formatUrl = e.target.closest('.preview-btn').dataset.formatUrl;
                const formatType = e.target.closest('.preview-btn').dataset.formatType;
                this.previewFormat(formatId, formatUrl, formatType);
            });
        });
    }

    handleDownload(event) {
        this.downloadCount++;
        this.updateDownloadCount();
        localStorage.setItem('downloadCount', this.downloadCount.toString());
        
        this.showToast('Download started! 📥', 'success');
        this.triggerConfetti();
        
        const button = event.target.closest('.download-btn');
        if (button) {
            this.addDownloadAnimation(button);
        }
    }

    addDownloadAnimation(button) {
        button.style.transform = 'scale(0.95)';
        button.style.background = 'var(--success-color)';
        
        setTimeout(() => {
            button.style.transform = 'scale(1)';
        }, 150);
        
        setTimeout(() => {
            button.style.background = '';
        }, 1000);
    }

    previewFormat(formatId, url, type) {
        const modal = document.getElementById('previewModal');
        const playerContainer = document.getElementById('playerContainer');
        const previewTitle = document.getElementById('previewTitle');
        const directDownloadButton = document.getElementById('directDownloadButton');
        
        playerContainer.innerHTML = '';
        
        previewTitle.textContent = `${type === 'video' ? 'Video' : 'Audio'} Preview`;
        
        const mediaElement = document.createElement(type === 'video' ? 'video' : 'audio');
        mediaElement.src = url;
        mediaElement.controls = true;
        mediaElement.style.width = '100%';
        mediaElement.style.height = 'auto';
        
        mediaElement.onerror = () => {
            playerContainer.innerHTML = `
                <div style="padding: 2rem; text-align: center; color: var(--error-color);">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                    <p>Preview not available for this format</p>
                    <p style="font-size: 0.9rem; opacity: 0.7;">You can still download the file</p>
                </div>
            `;
        };
        
        playerContainer.appendChild(mediaElement);
        
        const filename = this.generateFilename(this.findFormatById(formatId), type === 'video');
        directDownloadButton.href = `${this.API_BASE}/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
        
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    closeModal() {
        const modal = document.getElementById('previewModal');
        const playerContainer = document.getElementById('playerContainer');
        
        const mediaElement = playerContainer.querySelector('video, audio');
        if (mediaElement) {
            mediaElement.pause();
            mediaElement.src = '';
        }
        
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    findFormatById(formatId) {
        if (!this.currentVideoData) return null;
        
        const allFormats = [
            ...(this.currentVideoData.downloadable_formats || []),
            ...(this.currentVideoData.audio_formats || [])
        ];
        
        return allFormats.find(format => format.format_id === formatId);
    }

    generateFilename(format, isVideo) {
        if (!format || !this.currentVideoData) return 'download';
        
        const title = this.currentVideoData.title?.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_') || 'video';
        const quality = format.quality_note?.replace(/[^\w]/g, '') || '';
        const ext = format.ext || (isVideo ? 'mp4' : 'mp3');
        
        return `${title}_${quality}.${ext}`.replace(/__+/g, '_');
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatNumber(num) {
        if (!num) return null;
        
        if (num >= 1000000000) {
            return (num / 1000000000).toFixed(1) + 'B';
        } else if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        
        return num.toLocaleString();
    }

    formatDate(dateString) {
        if (!dateString) return null;
        
        try {
            const date = new Date(dateString.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return dateString;
        }
    }

    showLoading(message = 'Loading...') {
        const loadingSection = document.getElementById('loading-section');
        const loadingText = document.querySelector('.loading-text');
        
        if (loadingText) loadingText.textContent = message;
        loadingSection.classList.remove('hidden');
        
        this.animateProgress();
    }

    hideLoading() {
        const loadingSection = document.getElementById('loading-section');
        loadingSection.classList.add('hidden');
    }

    showError(message) {
        const errorSection = document.getElementById('error-section');
        const errorMessage = document.getElementById('errorMessage');
        
        errorMessage.textContent = message;
        errorSection.classList.remove('hidden');
        
        errorSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    hideError() {
        const errorSection = document.getElementById('error-section');
        errorSection.classList.add('hidden');
    }

    hideResults() {
        const resultsSection = document.getElementById('results-section');
        resultsSection.classList.add('hidden');
    }

    setupTheme() {
        document.documentElement.className = this.theme;
        this.updateThemeIcon();
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        document.documentElement.className = this.theme;
        localStorage.setItem('theme', this.theme);
        this.updateThemeIcon();
        
        this.showToast(`Switched to ${this.theme} theme`, 'success', 2000);
    }

    updateThemeIcon() {
        const themeToggle = document.getElementById('theme-toggle');
        const icon = themeToggle.querySelector('i');
        
        if (this.theme === 'light') {
            icon.className = 'fas fa-moon';
        } else {
            icon.className = 'fas fa-sun';
        }
    }

    setupAnimations() {
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.animation = 'slideInUp 0.6s var(--transition-bounce)';
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        document.querySelectorAll('.feature-card, .glass-card').forEach(el => {
            observer.observe(el);
        });
    }

    showWelcomeAnimation() {
        const heroContent = document.querySelector('.hero-content');
        if (heroContent) {
            heroContent.style.opacity = '0';
            heroContent.style.transform = 'translateY(30px)';
            
            setTimeout(() => {
                heroContent.style.transition = 'all 1s var(--transition-bounce)';
                heroContent.style.opacity = '1';
                heroContent.style.transform = 'translateY(0)';
            }, 100);
        }
    }

    animateProgress() {
        const progressBar = document.querySelector('.progress-bar');
        if (!progressBar) return;
        
        let width = 0;
        const interval = setInterval(() => {
            width += Math.random() * 15;
            if (width >= 100) {
                width = 100;
                clearInterval(interval);
            }
            progressBar.style.width = width + '%';
        }, 200);
    }

    shakeElement(element) {
        element.style.animation = 'shake 0.5s ease-in-out';
        setTimeout(() => {
            element.style.animation = '';
        }, 500);
    }

    showToast(message, type = 'info', duration = 4000) {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-icon">
                <i class="${icons[type] || icons.info}"></i>
            </div>
            <div class="toast-content">
                <div class="toast-message">${this.escapeHtml(message)}</div>
            </div>
            <button class="toast-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => this.removeToast(toast));
        
        toastContainer.appendChild(toast);
        
        setTimeout(() => this.removeToast(toast), duration);
    }

    removeToast(toast) {
        if (toast && toast.parentNode) {
            toast.style.animation = 'slideOutRight 0.3s ease forwards';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }
    }

    triggerConfetti() {
        const container = document.getElementById('confetti-container');
        const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];
        
        for (let i = 0; i < 50; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = Math.random() * 100 + '%';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animation = `confettiFall 3s linear forwards`;
                confetti.style.animationDelay = Math.random() * 1000 + 'ms';
                
                container.appendChild(confetti);
                
                setTimeout(() => {
                    if (confetti.parentNode) {
                        confetti.parentNode.removeChild(confetti);
                    }
                }, 3000);
            }, i * 50);
        }
    }

    handleKeyboardShortcuts(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            this.handleVideoFetch();
        }
        
        if (e.key === 'Escape') {
            this.closeModal();
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            this.toggleTheme();
        }
    }

    updateDownloadCount() {
        const downloadCountElement = document.getElementById('download-count');
        if (downloadCountElement) {
            downloadCountElement.textContent = this.downloadCount;
            
            downloadCountElement.style.transform = 'scale(1.2)';
            downloadCountElement.style.color = 'var(--accent-primary)';
            
            setTimeout(() => {
                downloadCountElement.style.transform = 'scale(1)';
                downloadCountElement.style.color = '';
            }, 300);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Add confetti animation CSS
const confettiStyles = document.createElement('style');
confettiStyles.textContent = `
    @keyframes confettiFall {
        0% {
            transform: translateY(-100vh) rotate(0deg);
            opacity: 1;
        }
        100% {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
        }
    }

    @keyframes slideOutRight {
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }

    .thumbnail-overlay {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.7);
        color: white;
        border-radius: 50%;
        width: 60px;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        opacity: 0;
        transition: all var(--transition-normal);
    }

    .thumbnail-container:hover .thumbnail-overlay {
        opacity: 1;
    }

    .video-description {
        margin-top: var(--space-lg);
        padding: var(--space-lg);
        background: var(--bg-secondary);
        border-radius: var(--radius-md);
        border-left: 4px solid var(--accent-primary);
    }

    .video-description p {
        color: var(--text-secondary);
        line-height: 1.6;
        margin: 0;
    }
`;
document.head.appendChild(confettiStyles);

document.addEventListener('DOMContentLoaded', () => {
    window.app = new DroporiaApp();
});

window.DroporiaApp = DroporiaApp;
