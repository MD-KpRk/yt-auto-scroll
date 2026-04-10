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
      language: 'en'
    };

    this.i18n = null;

    this.state = {
      isScrolling: false,
      isWaiting: false,
      isPausedByUser: false,
      manualScrollBlock: false,
      currentVideoId: "",
      skippedBuffer:[],
      
      isForceSkipping: false,     
      forceSkipVideoId: null,     
      lastScrollTime: 0,

      scrollTimeout: null,
      manualScrollTimeout: null,
      activeRing: null,
      activeBtn: null,
      activeReason: null
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
      if (!res.language) {
        res.language = chrome.i18n.getUILanguage().startsWith('ru') ? 'ru' : 'en';
      }
      Object.assign(this.config, res);
      this.loadI18n();
    });

    chrome.storage.onChanged.addListener((changes) => {
      let langChanged = false;
      for (const key in changes) {
        this.config[key] = changes[key].newValue;
        if (key === 'language') langChanged = true;
      }
      if (langChanged) this.loadI18n();
    });
  }

  async loadI18n() {
    try {
      const url = chrome.runtime.getURL(`_locales/${this.config.language}/messages.json`);
      const res = await fetch(url);
      const json = await res.json();
      this.i18n = {
        cancelScroll: json.cancelScroll?.message || 'Cancel Auto-Scroll',
        resumeScroll: json.resumeScroll?.message || 'Resume Auto-Scroll',
        skipReason: json.skipReason?.message || 'Longer than {limit} sec',
        watchVideo: json.watchVideo?.message || 'Continue watching'
      };
    } catch (e) {
      this.i18n = {
        cancelScroll: chrome.i18n.getMessage("cancelScroll") || 'Cancel Auto-Scroll',
        resumeScroll: chrome.i18n.getMessage("resumeScroll") || 'Resume Auto-Scroll',
        skipReason: chrome.i18n.getMessage("skipReason") || 'Longer than {limit} sec',
        watchVideo: chrome.i18n.getMessage("watchVideo") || 'Continue watching'
      };
    }
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
        z-index: 2147483647 !important; /* Ультимативный слой поверх всего плеера */
        pointer-events: all !important;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));
        opacity: 1;
        transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1), filter 0.2s ease, opacity 0.2s ease;
        cursor: pointer;
      }
      .yt-autoscroll-ring:hover {
        transform: translate(-50%, -50%) rotate(-90deg) scale(1.1);
        filter: drop-shadow(0 6px 12px rgba(0,0,0,0.6));
      }
      .yt-autoscroll-ring:active {
        transform: translate(-50%, -50%) rotate(-90deg) scale(0.95);
      }
      .yt-autoscroll-ring circle {
        fill: transparent;
        stroke-width: 5;
      }
      .yt-autoscroll-ring .shadow-bg {
        fill: rgba(0, 0, 0, 0.5);
        stroke: none;
        transition: fill 0.2s ease;
      }
      .yt-autoscroll-ring:hover .shadow-bg {
        fill: rgba(0, 0, 0, 0.8);
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
      
      .yt-autoscroll-ring .ring-icon {
        transition: stroke 0.2s ease, fill 0.2s ease;
      }
      .yt-autoscroll-ring:hover .ring-icon.stroke-icon {
        stroke: #ff0033;
      }
      .yt-autoscroll-ring:hover .ring-icon.fill-icon {
        fill: #ff0033;
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
        z-index: 2147483647 !important;
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
      .yt-autoscroll-reason {
        position: absolute;
        top: calc(50% - 85px);
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 0, 51, 0.85);
        color: #fff;
        font-family: "Roboto", "Arial", sans-serif;
        font-size: 13px;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 20px;
        z-index: 2147483647 !important;
        white-space: nowrap;
        pointer-events: none;
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: yt-reason-fade 0.3s ease-out;
      }
      @keyframes yt-reason-fade {
        from { opacity: 0; transform: translate(-50%, 10px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
    `;
    document.head.appendChild(style);
  }

  getCancelHTML() {
    const text = this.i18n ? this.i18n.cancelScroll : 'Cancel Auto-Scroll';
    return `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
      <span>${text}</span>
    `;
  }

  getResumeHTML() {
    const text = this.i18n ? this.i18n.resumeScroll : 'Resume Auto-Scroll';
    return `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
      </svg>
      <span>${text}</span>
    `;
  }

  getWatchHTML() {
    const text = this.i18n ? this.i18n.watchVideo : 'Continue watching';
    return `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/>
      </svg>
      <span>${text}</span>
    `;
  }

  createSvg(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const[k, v] of Object.entries(attrs)) el.setAttribute(k, v);
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
    if (this.state.activeReason) {
      this.state.activeReason.remove();
      this.state.activeReason = null;
    }
  }

  bindSafeClick(element, handler) {
    element.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      handler(e);
    });
    element.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    }, { passive: true });
  }

  executeSkip(video) {
    if (video._ytAutoscrollPlayHandler) {
      video.removeEventListener('play', video._ytAutoscrollPlayHandler);
      video._ytAutoscrollPlayHandler = null;
    }
    this.clearUI();
    this.state.isWaiting = false;
    
    this.state.isForceSkipping = true;
    this.state.forceSkipVideoId = this.state.currentVideoId;
    this.state.lastScrollTime = Date.now();
    this.state.isScrolling = true;

    if (!video.paused) video.pause();
    this.triggerScroll();
  }

  cancelSkipAction(video, skipType) {
    if (video._ytAutoscrollPlayHandler) {
      video.removeEventListener('play', video._ytAutoscrollPlayHandler);
      video._ytAutoscrollPlayHandler = null;
    }
    this.clearUI();
    this.state.isWaiting = false;
    this.state.isPausedByUser = false;
    
    if (skipType === 'end') {
      video.currentTime = 0;
      video._lastTime = 0;
    }
    video.play();
  }

  performScroll(video, options = {}) {
    const { forceInstant = false, skipType = 'end', reasonText = null } = options;

    if (this.state.isScrolling || this.state.isWaiting || this.state.isPausedByUser) return;

    if (this.config.delay > 0 && !forceInstant) {
      this.state.isWaiting = true;

      const forcePause = () => {
        if (this.state.isWaiting && !video.paused) {
          video.pause();
        }
      };
      forcePause();
      setTimeout(forcePause, 50);
      setTimeout(forcePause, 150);

      // Чистим старый UI
      const mainContainer = video.closest(SELECTORS.container) || document;
      mainContainer.querySelectorAll('.yt-autoscroll-ring, .yt-autoscroll-control-btn, .yt-autoscroll-reason').forEach(el => el.remove());

      // Инжектим прямо в плеер, так как он идеально сжимается при открытых комментариях
      let uiTarget = video.closest('.html5-video-player') || video.parentElement;

      this.state.activeRing = this.createSvg('svg', { class: 'yt-autoscroll-ring', viewBox: '0 0 100 100' });
      const shadowBg = this.createSvg('circle', { class: 'shadow-bg', cx: '50', cy: '50', r: '43' });
      const bg = this.createSvg('circle', { class: 'bg', cx: '50', cy: '50', r: '46' });
      const progress = this.createSvg('circle', { class: 'progress', cx: '50', cy: '50', r: '46' });
      
      const iconGroup = this.createSvg('g', { 
        transform: 'rotate(90, 50, 50) translate(34, 34) scale(1.33)'
      });

      if (skipType === 'long') {
        iconGroup.setAttribute('class', 'ring-icon fill-icon');
        iconGroup.setAttribute('fill', 'rgba(255, 255, 255, 0.95)');
        iconGroup.setAttribute('stroke', 'none');
        
        const path1 = this.createSvg('path', { d: 'M8 5v14l11-7z' });
        iconGroup.appendChild(path1);
      } else {
        iconGroup.setAttribute('class', 'ring-icon stroke-icon');
        iconGroup.setAttribute('fill', 'none');
        iconGroup.setAttribute('stroke', 'rgba(255, 255, 255, 0.95)');
        iconGroup.setAttribute('stroke-width', '2');
        iconGroup.setAttribute('stroke-linecap', 'round');
        iconGroup.setAttribute('stroke-linejoin', 'round');
        
        const path1 = this.createSvg('path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' });
        const path2 = this.createSvg('path', { d: 'M21 3v5h-5' });
        iconGroup.appendChild(path1);
        iconGroup.appendChild(path2);
      }

      this.state.activeRing.appendChild(shadowBg);
      this.state.activeRing.appendChild(bg);
      this.state.activeRing.appendChild(progress);
      this.state.activeRing.appendChild(iconGroup);
      uiTarget.appendChild(this.state.activeRing);

      this.state.activeBtn = document.createElement('div');
      
      if (skipType === 'long') {
        this.state.activeBtn.className = 'yt-autoscroll-control-btn resume-mode';
        this.state.activeBtn.innerHTML = this.getWatchHTML();
      } else {
        this.state.activeBtn.className = 'yt-autoscroll-control-btn';
        this.state.activeBtn.innerHTML = this.getCancelHTML();
      }
      
      uiTarget.appendChild(this.state.activeBtn);

      if (reasonText) {
        this.state.activeReason = document.createElement('div');
        this.state.activeReason.className = 'yt-autoscroll-reason';
        this.state.activeReason.textContent = reasonText;
        uiTarget.appendChild(this.state.activeReason);
      }

      progress.style.transitionDuration = `${this.config.delay}ms`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          progress.style.strokeDashoffset = "0";
        });
      });

      const performTime = Date.now();
      video._ytAutoscrollPlayHandler = () => {
        if (Date.now() - performTime < 300) {
          forcePause();
          return;
        }
        if (!this.state.isWaiting) return;
        this.cancelSkipAction(video, skipType);
      };
      video.addEventListener('play', video._ytAutoscrollPlayHandler);

      this.bindSafeClick(this.state.activeRing, () => {
        this.cancelSkipAction(video, skipType);
      });

      this.bindSafeClick(this.state.activeBtn, () => {
        if (skipType === 'long') {
          this.cancelSkipAction(video, skipType);
        } else {
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
          
          this.bindSafeClick(this.state.activeBtn, () => {
            this.state.activeBtn.remove();
            this.state.activeBtn = null;
            this.state.isPausedByUser = false;
            this.executeSkip(video);
          });
          
          uiTarget.appendChild(this.state.activeBtn);
          video.play();
        }
      });

      this.state.scrollTimeout = setTimeout(() => this.executeSkip(video), this.config.delay);

    } else {
      this.executeSkip(video);
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

    if (this.state.isForceSkipping) {
      if (this.state.forceSkipVideoId !== videoId) {
        this.state.isForceSkipping = false;
        this.state.forceSkipVideoId = null;
        this.state.isScrolling = false;
      } else {
        const now = Date.now();
        if (now - this.state.lastScrollTime > 800) {
          this.state.lastScrollTime = now;
          if (!activeVideo.paused) activeVideo.pause();
          this.triggerScroll();
        }
        return; 
      }
    }

    if (this.state.isPausedByUser) {
      const btn = document.querySelector('.yt-autoscroll-control-btn.resume-mode');
      if (btn) {
        btn.style.opacity = activeVideo.paused ? '1' : '0';
        btn.style.pointerEvents = activeVideo.paused ? 'auto' : 'none';
      }
      return;
    }

    if (this.config.skipEnabled && !this.state.isWaiting) {
      if (duration && isFinite(duration) && duration > this.config.skipLimit) {
        if (!this.state.skippedBuffer.includes(videoId)) {
          
          this.state.skippedBuffer.push(videoId);
          if (this.state.skippedBuffer.length > 20) {
            this.state.skippedBuffer.shift();
          }

          const reasonText = this.i18n ? this.i18n.skipReason.replace('{limit}', this.config.skipLimit) : `Longer than ${this.config.skipLimit} sec`;
          
          this.performScroll(activeVideo, {
            skipType: 'long',
            reasonText: reasonText
          });

          return; 
        }
      }
    }

    if (activeVideo.paused && !isEnded) return;

    if (isEnded && !this.state.isScrolling && !this.state.isWaiting) {
      this.performScroll(activeVideo, { skipType: 'end' });
      return;
    }
  }
}

new YTShortsAutoScroller();