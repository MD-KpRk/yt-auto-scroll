const SELECTORS = {
  container: 'ytd-reel-video-renderer, .reel-video-in-sequence, .reel-video-in-sequence-new',
  ad: 'ytd-ad-slot-renderer, ad-button-view-model',
  titleLink: '.ytp-title-link'
};

class YTShortsAutoScroller {
  constructor() {
    this.config = {
      enabled: true,
      delay: 1000,
      skipEnabled: false,
      skipLimit: 60,
      language: 'ru'
    };

    this.state = {
      isScrolling: false,
      isWaiting: false,
      isPausedByUser: false,
      manualScrollBlock: false,
      currentVideoId: "",
      skippedBuffer: [],
      scrollTimeout: null,
      manualScrollTimeout: null,
      activeRing: null,
      activeBtn: null
    };

    this.init();
  }

  init() {
    this.loadStorage();
    this.injectStyles();
    this.attachListeners();
    setInterval(this.checkLoop.bind(this), 100);
  }

  loadStorage() {
    chrome.storage.local.get(['enabled', 'delay', 'skipEnabled', 'skipLimit', 'language'], (res) => {
      Object.assign(this.config, res);
    });
    chrome.storage.onChanged.addListener((changes) => {
      for (const key in changes) {
        this.config[key] = changes[key].newValue;
      }
    });
  }

  blockAutoScroll() {
    this.state.manualScrollBlock = true;
    clearTimeout(this.state.manualScrollTimeout);
    this.state.manualScrollTimeout = setTimeout(() => {
      this.state.manualScrollBlock = false;
    }, 800);
  }

  attachListeners() {
    const handler = this.blockAutoScroll.bind(this);
    window.addEventListener('wheel', handler, { passive: true });
    window.addEventListener('touchstart', handler, { passive: true });
    window.addEventListener('touchmove', handler, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
        this.blockAutoScroll();
      }
    }, { passive: true });
  }

  triggerScroll() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true
    }));
  }

  injectStyles() {
    if (document.getElementById('yt-autoscroll-styles')) return;
    const style = document.createElement('style');
    style.id = 'yt-autoscroll-styles';
    style.textContent = `
      .yt-autoscroll-ring {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-90deg);
        width: 90px;
        height: 90px;
        z-index: 9999;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));
        opacity: 1;
        transition: transform 0.2s ease, opacity 0.2s ease;
        pointer-events: auto;
        cursor: pointer;
      }
      .yt-autoscroll-ring:hover {
        transform: translate(-50%, -50%) rotate(-90deg) scale(1.05);
      }
      .yt-autoscroll-ring circle {
        fill: transparent;
        stroke-width: 5;
      }
      .yt-autoscroll-ring .shadow-bg {
        fill: rgba(0, 0, 0, 0.45);
        stroke: none;
        transition: fill 0.2s ease;
      }
      .yt-autoscroll-ring:hover .shadow-bg {
        fill: rgba(0, 0, 0, 0.65);
      }
      .yt-autoscroll-ring .bg {
        stroke: rgba(255, 255, 255, 0.15);
      }
      .yt-autoscroll-ring .progress {
        stroke: #ff0000;
        stroke-dasharray: 289;
        stroke-dashoffset: 289;
        stroke-linecap: round;
        transition-property: stroke-dashoffset;
        transition-timing-function: linear;
      }
      .yt-autoscroll-control-btn {
        position: absolute;
        top: calc(50% + 70px);
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: #fff;
        font-family: "Roboto", "Arial", sans-serif;
        font-size: 14px;
        font-weight: 500;
        padding: 10px 20px 10px 16px;
        border-radius: 36px;
        border: none;
        cursor: pointer;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
        pointer-events: auto;
        white-space: nowrap;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .yt-autoscroll-control-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: translateX(-50%) scale(1.03);
      }
      .yt-autoscroll-control-btn svg {
        margin-top: -1px;
      }
      .yt-autoscroll-control-btn.resume-mode {
        background: rgba(0, 0, 0, 0.7);
      }
      .yt-autoscroll-control-btn.resume-mode:hover {
        background: rgba(255, 0, 0, 0.9);
        box-shadow: 0 4px 16px rgba(255, 0, 0, 0.4);
      }
    `;
    document.head.appendChild(style);
  }

  getCancelHTML() {
    const text = this.config.language === 'en' ? 'Cancel Auto-Scroll' : 'Отменить авто-скролл';
    return `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
      <span>${text}</span>
    `;
  }

  getResumeHTML() {
    const text = this.config.language === 'en' ? 'Resume Auto-Scroll' : 'Продолжить авто-скролл';
    return `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
      <span>${text}</span>
    `;
  }

  createSvg(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  clearUI() {
    clearTimeout(this.state.scrollTimeout);
    if (this.state.activeRing) {
      this.state.activeRing.remove();
      this.state.activeRing = null;
    }
    if (this.state.activeBtn) {
      this.state.activeBtn.remove();
      this.state.activeBtn = null;
    }
  }

  performScroll(video, forceInstant = false) {
    if (this.state.isScrolling || this.state.isWaiting || this.state.isPausedByUser) return;

    if (this.config.delay > 0 && !forceInstant) {
      this.state.isWaiting = true;
      video.pause();

      const playerContainer = video.closest('.html5-video-player') || video.parentElement;
      playerContainer.querySelectorAll('.yt-autoscroll-ring, .yt-autoscroll-control-btn').forEach(el => el.remove());

      this.state.activeRing = this.createSvg('svg', { class: 'yt-autoscroll-ring', viewBox: '0 0 100 100' });
      const shadowBg = this.createSvg('circle', { class: 'shadow-bg', cx: '50', cy: '50', r: '43' });
      const bg = this.createSvg('circle', { class: 'bg', cx: '50', cy: '50', r: '46' });
      const progress = this.createSvg('circle', { class: 'progress', cx: '50', cy: '50', r: '46' });
      
      const iconGroup = this.createSvg('g', { transform: 'rotate(90, 50, 50) translate(32, 32) scale(1.5)' });
      const iconPath = this.createSvg('path', { 
        d: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z', 
        fill: 'rgba(255, 255, 255, 0.95)' 
      });

      iconGroup.appendChild(iconPath);
      this.state.activeRing.appendChild(shadowBg);
      this.state.activeRing.appendChild(bg);
      this.state.activeRing.appendChild(progress);
      this.state.activeRing.appendChild(iconGroup);
      playerContainer.appendChild(this.state.activeRing);

      this.state.activeBtn = document.createElement('div');
      this.state.activeBtn.className = 'yt-autoscroll-control-btn';
      this.state.activeBtn.innerHTML = this.getCancelHTML();
      playerContainer.appendChild(this.state.activeBtn);

      progress.style.transitionDuration = `${this.config.delay}ms`;
      
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          progress.style.strokeDashoffset = "0";
        });
      });

      const doSkip = () => {
        if (video._ytAutoscrollPlayHandler) {
          video.removeEventListener('play', video._ytAutoscrollPlayHandler);
          video._ytAutoscrollPlayHandler = null;
        }
        this.clearUI();
        this.state.isWaiting = false;
        this.state.isScrolling = true;
        this.triggerScroll();
        setTimeout(() => { this.state.isScrolling = false; }, 800);
      };

      if (video._ytAutoscrollPlayHandler) {
        video.removeEventListener('play', video._ytAutoscrollPlayHandler);
      }

      const performTime = Date.now();
      video._ytAutoscrollPlayHandler = () => {
        if (Date.now() - performTime < 200) return;
        if (!this.state.isWaiting) return;
        this.clearUI();
        this.state.isWaiting = false;
        video.removeEventListener('play', video._ytAutoscrollPlayHandler);
        video._ytAutoscrollPlayHandler = null;
      };
      video.addEventListener('play', video._ytAutoscrollPlayHandler);

      this.state.activeRing.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (video._ytAutoscrollPlayHandler) {
          video.removeEventListener('play', video._ytAutoscrollPlayHandler);
          video._ytAutoscrollPlayHandler = null;
        }
        this.clearUI();
        this.state.isWaiting = false;
        this.state.isPausedByUser = false;
        video.currentTime = 0;
        video._lastTime = 0;
        video.play();
      });

      this.state.activeBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (video._ytAutoscrollPlayHandler) {
          video.removeEventListener('play', video._ytAutoscrollPlayHandler);
          video._ytAutoscrollPlayHandler = null;
        }
        this.clearUI();
        this.state.isWaiting = false;
        this.state.isPausedByUser = true;
        
        this.state.activeBtn = document.createElement('div');
        this.state.activeBtn.className = 'yt-autoscroll-control-btn resume-mode';
        this.state.activeBtn.innerHTML = this.getResumeHTML();
        
        this.state.activeBtn.onmousedown = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.state.activeBtn.remove();
          this.state.activeBtn = null;
          this.state.isPausedByUser = false;
          this.state.isScrolling = true;
          this.triggerScroll();
          setTimeout(() => { this.state.isScrolling = false; }, 800);
        };
        
        playerContainer.appendChild(this.state.activeBtn);
        video.play();
      });

      this.state.scrollTimeout = setTimeout(doSkip, this.config.delay);

    } else {
      this.state.isScrolling = true;
      this.triggerScroll();
      setTimeout(() => { this.state.isScrolling = false; }, 800);
    }
  }

  checkLoop() {
    if (!this.config.enabled || !window.location.pathname.startsWith('/shorts/')) return;

    const videos = document.getElementsByTagName('video');
    let activeVideo = null;
    let maxVisibleArea = 0;

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (!v.hasAttribute('loop')) v.setAttribute('loop', '');

      const rect = v.getBoundingClientRect();
      const visibleTop = Math.max(0, rect.top);
      const visibleBottom = Math.min(window.innerHeight, rect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      const visibleArea = visibleHeight * rect.width;

      if (visibleArea > maxVisibleArea) {
        maxVisibleArea = visibleArea;
        activeVideo = v;
      }
    }

    if (!activeVideo || activeVideo.readyState < 2 || this.state.manualScrollBlock) return;

    const container = activeVideo.closest(SELECTORS.container);
    if (container && container.querySelector(SELECTORS.ad)) {
      if (!this.state.isScrolling) {
        this.state.isScrolling = true;
        this.triggerScroll();
        setTimeout(() => { this.state.isScrolling = false; }, 800);
      }
      return;
    }

    let videoId = null;
    const player = activeVideo.closest('.html5-video-player');
    if (player) {
      const titleLink = player.querySelector(SELECTORS.titleLink);
      if (titleLink && titleLink.href) {
        const match = titleLink.href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        if (match) videoId = match[1];
      }
    }

    if (!videoId) {
      const match = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (match) videoId = match[1];
    }

    if (!videoId) return;

    if (this.state.currentVideoId !== videoId) {
      this.state.currentVideoId = videoId;
      this.state.isPausedByUser = false;
      this.state.isWaiting = false;
      this.state.isScrolling = false;
      activeVideo._lastTime = activeVideo.currentTime;
      this.clearUI();
      document.querySelectorAll('.yt-autoscroll-ring, .yt-autoscroll-control-btn').forEach(el => el.remove());
    }

    const currentTime = activeVideo.currentTime;
    const duration = activeVideo.duration || 0;

    if (typeof activeVideo._lastTime === 'undefined') {
      activeVideo._lastTime = currentTime;
    }

    let isEnded = false;
    if (duration > 0) {
      const thresholdEnd = Math.max(duration - 1.5, duration * 0.8);
      const thresholdStart = Math.min(1.5, duration * 0.2);
      if (activeVideo._lastTime > thresholdEnd && currentTime < thresholdStart) {
        isEnded = true;
      }
    }

    activeVideo._lastTime = currentTime;

    if (this.state.isPausedByUser) {
      const btn = document.querySelector('.yt-autoscroll-control-btn.resume-mode');
      if (btn) {
        btn.style.opacity = activeVideo.paused ? '1' : '0';
        btn.style.pointerEvents = activeVideo.paused ? 'auto' : 'none';
      }
      return;
    }

    if (activeVideo.paused && !isEnded) return;

    if (isEnded && !this.state.isScrolling && !this.state.isWaiting) {
      this.performScroll(activeVideo, false);
      return;
    }

    if (this.config.skipEnabled && !this.state.isScrolling && !this.state.isWaiting) {
      if (!duration || !isFinite(duration)) return;
      if (this.state.skippedBuffer.includes(videoId)) return;

      if (duration > this.config.skipLimit) {
        activeVideo.pause();
        this.state.skippedBuffer.push(videoId);
        if (this.state.skippedBuffer.length > 20) {
          this.state.skippedBuffer.shift();
        }
        this.performScroll(activeVideo, true);
      }
    }
  }
}

new YTShortsAutoScroller();