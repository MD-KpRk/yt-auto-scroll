/* Lifecycle: idle -> waiting -> scrolling, or blocked after manual navigation. */
class YTShortsAutoScroller {
  constructor() {
    this.config = AutoScrollSettings.normalize();
    this.rawSettings = {};
    this.i18n = {};
    this.mode = 'idle';
    this.operation = null;
    this.current = null;
    this.dismissed = new Set();
    this.failed = new Set();
    this.blockedUntil = 0;
    this.visited = new Set();
    this.lastVisitedId = null;
    this.returnedVideoId = null;
    this.autoNavigation = null;
    this.isDebug = true;
    this.languageRequest = 0;
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (message?.type === 'YT_AUTOSCROLL_STATUS') {
        reply({ version: chrome.runtime.getManifest().version, ...this.status() });
      }
    });
    Promise.resolve(this.init()).catch(error => console.error('[YT AutoScroll] Initialization failed', error));
  }

  async init() {
    this.debugLog('Initializing');
    try {
      this.rawSettings = await chrome.storage.local.get(Object.keys(this.config));
      this.config = AutoScrollSettings.normalize(this.rawSettings);
    } catch (error) { console.error('AutoScroll: settings could not be loaded', error); }
    // Translations must never block playback listeners or the watchdog.
    this.loadLanguage();
    this.debugLog('Settings loaded', this.config);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') this.settingsChanged(changes);
    });
    window.addEventListener('yt-navigate-finish', () => this.refresh());
    document.addEventListener('visibilitychange', () => this.refresh());
    const manual = event => {
      if (!event.isTrusted || event.target.closest?.('.yt-autoscroll-wrapper')) return;
      if (this.current?.seekDragging) return;
      if (event.type === 'keydown' && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) return;
      if (AutoScrollSettings.isShorts(location.href)) this.block();
    };
    for (const event of ['wheel', 'touchmove', 'keydown']) window.addEventListener(event, manual, { passive: true, capture: true });
    window.addEventListener('click', event => {
      if (event.isTrusted && AutoScrollSettings.isShorts(location.href) &&
        event.target.closest?.('#navigation-button-up, #navigation-button-down')) this.block();
    }, { capture: true });
    window.addEventListener('popstate', () => {
      if (AutoScrollSettings.isShorts(location.href)) this.block();
    });
    // Seeking is explicit user intent, including clicking a progress bar.
    const seekIntent = event => {
      if (!event.isTrusted || event.target.closest?.('.yt-autoscroll-wrapper')) return;
      if (event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (event.type === 'keydown' && !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'j', 'l', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(event.key)) return;
      if (event.type === 'pointerdown' && !event.target.closest?.('.ytp-progress-bar-container, .ytp-progress-bar, .ytp-scrubber-container, [role="slider"]')) return;
      this.beginSeek(event.type === 'pointerdown');
    };
    window.addEventListener('pointerdown', seekIntent, { passive: true, capture: true });
    window.addEventListener('keydown', seekIntent, { passive: true, capture: true });
    for (const event of ['pointerup', 'pointercancel', 'blur']) {
      window.addEventListener(event, () => {
        if (this.current?.seekDragging) this.finishSeek();
      }, { capture: true });
    }
    // One low-frequency watchdog handles DOM replacement and missed SPA events.
    this.watchdog = setInterval(() => this.refresh(), 1000);
    window.addEventListener('pagehide', () => {
      this.stopOperation();
      this.detachVideo();
    });
    this.refresh();
  }

  async loadLanguage() {
    const request = ++this.languageRequest;
    try {
      const dictionary = await AutoScrollSettings.translations(this.config.language);
      if (request !== this.languageRequest) return;
      this.i18n = dictionary;
      if (this.operation?.ui) this.operation.ui.update(this.i18n, this.config.skipLimit);
    } catch (error) { console.error('AutoScroll: translations could not be loaded', error); }
  }

  settingsChanged(changes) {
    this.debugLog('Settings changed', changes);
    for (const key of Object.keys(this.config)) {
      if (changes[key]) {
        if (changes[key].newValue === undefined) delete this.rawSettings[key];
        else this.rawSettings[key] = changes[key].newValue;
      }
    }
    this.config = AutoScrollSettings.normalize(this.rawSettings);
    if (changes.language) this.loadLanguage();
    const operation = this.operation;
    if (operation && !this.allowed(operation.type, operation.video)) this.stopOperation(true);
    else if (operation && changes.delay && this.mode === 'waiting') {
      const { video, type } = operation;
      this.stopOperation();
      this.start(video, type, operation.pausedByUs);
    }
    this.refresh();
  }

  running() {
    return AutoScrollSettings.isShorts(location.href) && AutoScrollSettings.anyEnabled(this.config) && !document.hidden;
  }

  allowed(type, video) {
    if (this.current && this.current.id === this.returnedVideoId) return false;
    if (type === 'end') return this.config.enabled;
    if (type === 'ad') return this.config.skipAds && AutoScrollYouTube.isAd(video);
    return this.config.skipEnabled && !AutoScrollYouTube.isAd(video) && Number.isFinite(video.duration) && video.duration > this.config.skipLimit;
  }

  remember(set, key) {
    set.add(key);
    if (set.size > 100) set.delete(set.values().next().value);
  }

  block() {
    this.debugLog('Manual navigation: blocking automation for 2 seconds');
    this.blockedUntil = Date.now() + 2000;
    this.autoNavigation = null;
    this.stopOperation(true);
    this.mode = 'blocked';
  }

  detachVideo() {
    if (!this.current) return;
    this.current.events.abort();
    this.current.observer.disconnect();
    this.current.video.loop = this.current.originalLoop;
    this.current = null;
  }

  beginSeek(dragging = false) {
    const current = this.current;
    if (!current) return;
    current.seekDragging = current.seekDragging || dragging;
    current.userSeekUntil = Date.now() + 1500;
    current.seekBlockUntil = Date.now() + 500;
    current.ignoreEndUntil = current.seekBlockUntil;
    current.pendingEnd = false;
    current.lastTime = current.video.currentTime;
    // Scrubbing expresses an intent to watch, not to skip this ad/long video again.
    this.remember(this.dismissed, `${current.id}:long`);
    this.remember(this.dismissed, `${current.id}:ad`);
    this.autoNavigation = null;
    // Leave time and paused/playing state to the player during a seek.
    this.stopOperation();
    this.debugLog('Seeking: cancelled automatic transition', { videoId: current.id });
  }

  finishSeek() {
    if (!this.current) return;
    this.current.seekDragging = false;
    this.current.lastTime = this.current.video.currentTime;
    this.current.userSeekUntil = Date.now() + 1500;
    this.current.seekBlockUntil = Date.now() + 500;
    this.current.ignoreEndUntil = this.current.seekBlockUntil;
    this.current.pendingEnd = false;
  }

  attachVideo(video, id) {
    if (video || this.current) this.debugLog('Active video changed', { from: this.current?.id, to: id });
    if (video && id && id !== this.lastVisitedId) {
      const automatic = this.autoNavigation && this.autoNavigation.from !== id && Date.now() < this.autoNavigation.until;
      this.returnedVideoId = this.visited.has(id) && !automatic ? id : null;
      if (this.returnedVideoId) this.debugLog('Manual return: keeping this video until manual navigation', { videoId: id });
      this.remember(this.visited, id);
      this.lastVisitedId = id;
      this.autoNavigation = null;
    }
    this.stopOperation();
    this.detachVideo();
    if (!video || !id) return;
    const events = new AbortController();
    const observer = new IntersectionObserver(() => this.refresh(), { threshold: [0, 0.25, 0.5, 0.75, 1] });
    this.current = { video, id, source: video.currentSrc, path: location.pathname, events,
      observer, originalLoop: video.loop, lastTime: video.currentTime, changedAt: Date.now(), ignoreEndUntil: 0,
      userSeekUntil: 0, pendingEnd: false, seekDragging: false, seekBlockUntil: 0 };
    observer.observe(video);
    const options = { signal: events.signal };
    video.addEventListener('ended', () => this.evaluate(true), options);
    for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'play']) {
      video.addEventListener(event, () => this.evaluate(), options);
    }
    video.addEventListener('seeked', () => {
      if (!this.current || this.current.video !== video) return;
      if (!this.current.pendingEnd && !this.current.seekDragging) this.finishSeek();
      this.evaluate();
    }, options);
    video.addEventListener('seeking', () => {
      if (!this.current || this.current.video !== video) return;
      const automaticWrap = !this.current.seekDragging && Date.now() >= this.current.userSeekUntil &&
        this.current.lastTime > Math.max(video.duration - 1.5, video.duration * 0.8) &&
        video.currentTime < Math.min(1.5, video.duration * 0.2);
      if (automaticWrap) {
        this.current.pendingEnd = true;
        this.debugLog('Automatic replay detected', { videoId: this.current.id });
        return;
      }
      this.beginSeek();
    }, options);
    // Native ended is reliable when looping is disabled; restore the page's value on detach.
    video.loop = this.config.enabled && id !== this.returnedVideoId ? false : this.current.originalLoop;
  }

  refresh() {
    if (!this.running()) {
      this.stopOperation(true);
      this.detachVideo();
      this.mode = 'idle';
      this.debugStatus();
      return;
    }
    const video = AutoScrollYouTube.activeVideo();
    const id = AutoScrollYouTube.identity(video);
    if (video !== this.current?.video || id !== this.current?.id || video?.currentSrc !== this.current?.source || location.pathname !== this.current?.path) {
      this.attachVideo(video, id);
    }
    if (this.current) this.current.video.loop = this.config.enabled && this.current.id !== this.returnedVideoId ? false : this.current.originalLoop;
    this.evaluate();
    this.debugStatus();
  }

  debugLog(message, details) {
    if (this.isDebug) console.log('[YT AutoScroll]', message, details ?? '');
  }

  debugStatus() {
    if (!this.isDebug) return;
    const status = this.status();
    const signature = JSON.stringify(status);
    if (signature === this.lastDebugStatus) return;
    this.lastDebugStatus = signature;
    this.debugLog('State', status);
  }

  status() {
    const reason = !AutoScrollSettings.isShorts(location.href) ? 'not-shorts'
      : !AutoScrollSettings.anyEnabled(this.config) ? 'disabled'
      : document.hidden ? 'hidden' : !this.current ? 'no-video'
      : this.current.id === this.returnedVideoId ? 'manual-return'
      : this.current.seekDragging || this.current.video.seeking || Date.now() < this.current.seekBlockUntil ? 'seeking'
      : Date.now() < this.blockedUntil ? 'manual-navigation'
      : this.current.video.readyState < 2 ? 'loading-video'
      : this.failed.has(this.current.id) ? 'retries-exhausted'
      : this.current.video.paused && !this.operation ? 'paused' : this.mode;
    return {
      reason,
      mode: this.mode, running: this.running(), hidden: document.hidden,
      videoId: this.current?.id ?? null, paused: this.current?.video.paused,
      readyState: this.current?.video.readyState, ended: this.current?.video.ended
    };
  }

  evaluate(endedEvent = false) {
    const current = this.current;
    if (!current || !this.running()) return;
    const video = current.video;
    const previousTime = current.lastTime;
    current.lastTime = video.currentTime;
    if (current.seekDragging || Date.now() < current.seekBlockUntil) return;
    if (current.id === this.returnedVideoId) { this.mode = 'blocked'; return; }
    if (Date.now() < this.blockedUntil) { this.mode = 'blocked'; return; }
    if (this.mode === 'blocked') this.mode = 'idle';
    if (this.operation || video.readyState < 2 || video.seeking) return;
    // Events on a recycled or off-screen player must never operate on the next Short.
    if (!this.sameVideo(current, false)) return;
    const ad = AutoScrollYouTube.isAd(video);
    let type = null;
    if (ad && this.config.skipAds && !this.dismissed.has(`${current.id}:ad`) && Date.now() - current.changedAt >= 300) type = 'ad';
    else if (!ad && this.allowed('long', video) && !this.dismissed.has(`${current.id}:long`)) type = 'long';
    const wrapped = previousTime > Math.max(video.duration - 1.5, video.duration * 0.8) && video.currentTime < Math.min(1.5, video.duration * 0.2);
    if (!type && this.config.enabled && Date.now() >= current.ignoreEndUntil && (endedEvent || video.ended || wrapped || current.pendingEnd)) type = 'end';
    if (!type || this.failed.has(current.id) || this.dismissed.has(`${current.id}:${type}`)) return;
    // Respect a user pause; an ended video is paused by definition.
    if (video.paused && !(type === 'end' && video.ended)) return;
    this.start(video, type);
    if (this.operation) current.pendingEnd = false;
  }

  sameVideo(target, checkVisibility = true) {
    return target.video.isConnected && location.pathname === target.path &&
      target.video.currentSrc === target.source && AutoScrollYouTube.identity(target.video) === target.id &&
      (!checkVisibility || AutoScrollYouTube.activeVideo() === target.video);
  }

  valid(operation) {
    return this.operation === operation && this.running() && Date.now() >= this.blockedUntil &&
      !operation.video.seeking && !this.current?.seekDragging && Date.now() >= (this.current?.seekBlockUntil || 0) &&
      this.allowed(operation.type, operation.video) && this.sameVideo(operation);
  }

  start(video, type, wasPausedByUs = false) {
    if (this.operation || !this.current || !this.running() || Date.now() < this.blockedUntil ||
      video.seeking || this.current.seekDragging || Date.now() < this.current.seekBlockUntil ||
      !this.sameVideo(this.current) || !this.allowed(type, video)) return;
    const operation = { ...this.current, type, events: new AbortController(), timer: null, ui: null,
      attempts: 0, pausedByUs: wasPausedByUs || !video.paused };
    this.operation = operation;
    this.debugLog('Starting transition', { videoId: operation.id, type, delay: this.config.delay });
    this.mode = 'waiting';
    video.pause();
    if (!this.config.delay) { this.execute(operation); return; }
    operation.ui = new AutoScrollOverlay(video, type, this.i18n, this.config.skipLimit, this.config.delay, () => this.cancel(operation));
    video.addEventListener('play', () => {
      if (video.seeking || this.current?.seekDragging || Date.now() < (this.current?.userSeekUntil || 0)) this.beginSeek();
      else this.cancel(operation);
    }, { signal: operation.events.signal });
    operation.timer = setTimeout(() => this.execute(operation), this.config.delay);
  }

  execute(operation) {
    if (!this.valid(operation)) {
      this.debugLog('Discarding stale or disabled transition', { videoId: operation.id, type: operation.type });
      if (this.operation === operation) this.stopOperation();
      return;
    }
    operation.events.abort();
    operation.ui?.remove();
    operation.ui = null;
    this.mode = 'scrolling';
    if (operation.attempts >= 3) {
      this.remember(this.failed, operation.id);
      this.stopOperation(true);
      console.warn('AutoScroll: could not advance; automatic retries stopped for this video.');
      return;
    }
    operation.attempts++;
    this.autoNavigation = { from: operation.id, until: Date.now() + 5000 };
    this.debugLog('Next video attempt', { videoId: operation.id, attempt: operation.attempts });
    AutoScrollYouTube.next(operation.video);
    // A synchronous navigation handler may already have cancelled this operation.
    if (this.operation === operation) operation.timer = setTimeout(() => this.execute(operation), 1500);
  }

  cancel(operation) {
    if (this.operation !== operation) return;
    this.debugLog('Transition cancelled by playback or overlay', { videoId: operation.id, type: operation.type });
    if (!this.sameVideo(operation)) { this.stopOperation(); return; }
    if (operation.type !== 'end') this.remember(this.dismissed, `${operation.id}:${operation.type}`);
    this.stopOperation();
    if (operation.type === 'end') {
      operation.video.currentTime = 0;
      if (this.current) this.current.lastTime = 0;
    }
    this.play(operation.video);
  }

  stopOperation(resume = false) {
    const operation = this.operation;
    this.operation = null;
    this.mode = 'idle';
    if (!operation) return;
    this.debugLog('Transition stopped', { videoId: operation.id, type: operation.type, resume });
    clearTimeout(operation.timer);
    operation.events.abort();
    operation.ui?.remove();
    if (resume && operation.pausedByUs && this.sameVideo(operation) && !operation.video.ended) this.play(operation.video);
  }

  play(video) {
    try {
      const result = video.play();
      result?.catch(error => console.warn('AutoScroll: playback could not resume', error));
    } catch (error) { console.warn('AutoScroll: playback could not resume', error); }
  }
}

new YTShortsAutoScroller();
