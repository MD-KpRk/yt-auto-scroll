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
    this.loopInterval = null; 

    this.state = {
      // -- СОСТОЯНИЕ --
      isDebug: true,              // Включить расширенное логирование в консоль
      isScrolling: false,         // Идет ли сейчас процесс физического прокручивания
      isTimerActive: false,       // Запущен ли таймер (кольцо) перед скроллом
      manualScrollBlock: false,   // Заблокирован ли авто-скролл из-за того, что юзер крутит страницу сам

      // -- ДАННЫЕ --
      currentVideoId: "",         // ID текущего обрабатываемого видео
      skippedBuffer:[],           // Кеш ID видео, которые мы уже пропущены (чтобы не пропустить повторно при возврате)

      // -- ТАЙМЕРЫ --
      scrollTimeout: null,        // Ссылка на таймер запуска скролла
      manualScrollTimeout: null,  // Ссылка на таймер разблокировки после ручного скролла
      
      // -- UI ЭЛЕМЕНТЫ --
      activeRing: null,           // Ссылка на DOM-элемент (SVG кольцо), если оно на экране
      activeBtn: null,            // Ссылка на DOM-элемент (кнопка действия), если она на экране

      // -- ВРЕМЕННЫЕ ДАННЫЕ ТЕКУЩЕГО ВИДЕО --
      activeVideo: null,          // Ссылка на текущий объект HTMLVideoElement
      activeSkipType: null,       // Тип текущего ожидания ('end' — конец видео, 'long' — пропуск длинного)
      waitingVideoId: null,       // ID видео, которое сейчас находится в режиме ожидания (для проверки актуальности)
      videoChangedTime: 0         // Время появления нового видео на экране
    };

    this.init();
  }

  init() {
    this.debugLog('Initializing YTShortsAutoScroller');
    chrome.storage.local.get(['enabled', 'delay', 'skipEnabled', 'skipLimit', 'language'], 
      (res) => {
      this.setConfig(res);                                                                    // Загрузка сохраненных настроек из хранилища и обновление конфигурации
      this.loadI18n();                                                                        // Загрузка переводов для текущего языка (для UI и сообщений)
      this.smartSwitchWorking(true);                                                          // Запуск или остановка главного цикла в зависимости от текущего URL и настроек (если мы уже на странице шортов, цикл запустится сразу)
    });

    // -- ГЛОБАЛЬНЫЕ ПОДПИСКИ --
    chrome.storage.onChanged.addListener(this.handleSettingsChange.bind(this));               // Отслеживание изменений в настройках попапа и мгновенное применение их в работе расширения
    window.addEventListener('yt-navigate-finish', () => this.smartSwitchWorking());           // Событие, которое ютуб выбрасывает при завершении навигации в рамках SPA (когда URL меняется, но страница не перезагружается)
    
    // -- ОБРАБОТКА РУЧНОГО СКРОЛЛА --
    const userInteractHandler = (e) => { if (e && e.isTrusted) this.blockAutoScroll();};      // Универсальный обработчик для всех видов взаимодействия, который блокирует авто-скролл на 2 секунды
    window.addEventListener('wheel', userInteractHandler, { passive: true });                 // Прослушка колесика мыши и блокировка авто-скролла при его использовании
    window.addEventListener('touchstart', userInteractHandler, { passive: true });            // Прослушка начала касания на сенсорных экранах
    window.addEventListener('touchmove', userInteractHandler, { passive: true });             // Прослушка движения пальца по экрану 
    
    window.addEventListener('keydown', (e) => { 
      if (e.isTrusted && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) { 
        this.blockAutoScroll();}}, { passive: true });                                        // Прослушка нажатия клавиш (стрелки, PgUp/PgDown) для блокировки авто-скролла при их использовании  
  }

  // === ОБРАБОТЧИКИ СОБЫТИЙ (Хендлеры) ===

  // хендлер для обработки изменений в настройках
  handleSettingsChange(changes) {
    this.debugLog('Settings changing handled');

    const flatChanges = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue]));   // Обновление конфигурации на основе полученных изменений
    this.setConfig(flatChanges);
    
    if (changes.language) this.loadI18n();
    
    // === ГОРЯЧЕЕ ОБНОВЛЕНИЕ UI ===
    // Если расширение отключили нужно остановить главный цикл, стереть UI и сбросить все таймеры, чтобы не осталось зависших колец на экране
    if (changes.enabled !== undefined) { this.smartSwitchWorking(changes.enabled.newValue);}

    // Если нет активного таймера, значит кольца нет и ничего не нужно обновлять
    if (!this.state.isTimerActive) return;

    // Если изменили время задержки во время работы таймера, нужно перезапустить таймер с новым временем
    if (changes.delay) {
      const video = this.state.activeVideo;
      const skipType = this.state.activeSkipType;
      const reasonText = document.querySelector('.yt-autoscroll-reason')?.textContent || null;
      this.clearUI();
      this.state.isTimerActive = false;
      this.performScroll(video, { skipType, reasonText });
    }
  }

  setConfig(data) {
    this.debugLog('Updating config: ' + JSON.stringify(data));
    const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
    Object.assign(this.config, cleanData);
  }

  // функция для логгирования в состоянии отладки
  debugLog(str){
    if (this.state.isDebug) {
      console.log('[YA]: ' + str);
    }
  }

  // функция для умного включения/выключения главного цикла
  smartSwitchWorking(turnOn = true) {
    // Цикл будет запущен тоглько когда входной параметр = true, расширение включено в настройках и мы находимся на странице шортов
    if (turnOn && this.config.enabled && window.location.pathname.startsWith('/shorts/')) {
      if (!this.loopInterval) {
        this.debugLog('Loop Activated');
        this.loopInterval = setInterval(this.checkLoop.bind(this), 100);
      }
    } 
    else {
      if (this.loopInterval) {
        this.debugLog('Loop Deactivated');
        clearInterval(this.loopInterval);
        this.loopInterval = null;
        this.stopEverything(); 
      }
    }
  }

  // функция для загрузки переводов из папки _locales
  async loadI18n() {
    try {
      this.debugLog('[i18n]: Loading ' + this.config.language + ' translations');
      const res = await fetch(chrome.runtime.getURL(`_locales/${this.config.language}/messages.json`));
      const data = await res.json();
      
      this.i18n = Object.fromEntries(Object.entries(data).map(([key, val]) => [key, val.message]));
    } catch (e) {
      console.error("YT AutoScroll: Failed to load translations", e);
      this.i18n = {};
    }
  }

  // === УПРАВЛЕНИЕ СОСТОЯНИЕМ ===
  // функция для мгновенной остановки всего процесса (остановка таймеров, сброс состояний, удаление UI)
  stopEverything() {
    this.clearUI();
    this.state.isTimerActive = false;
    this.state.isScrolling = false;
    this.state.waitingVideoId = null;
  }

  clearUI() {
    clearTimeout(this.state.scrollTimeout);
    document.querySelectorAll('.yt-autoscroll-wrapper').forEach(el => el.remove());
    this.state.activeRing = null;
    this.state.activeBtn = null;
    this.state.activeVideo = null;
    this.state.activeSkipType = null;
  }

  blockAutoScroll() {
    if (this.state.isTimerActive) {
      this.stopEverything();
    }
    this.state.manualScrollBlock = true;

    clearTimeout(this.state.manualScrollTimeout);
    this.state.manualScrollTimeout = setTimeout(() => {
      this.state.manualScrollBlock = false;
    }, 2000);
    this.debugLog('[UI]: Manual scroll detected, blocking auto-scroll for 2 seconds');
  }

  triggerScroll() {
    if (this.state.activeVideo) this.state.activeVideo.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true
    }));
  }

  // === ОТРИСОВКА ИНТЕРФЕЙСА (UI) ===

  getWatchAgainHTML() {
    const text = this.i18n?.watchAgain || 'Watch again';
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg><span>${text}</span>`;
  }

  getWatchHTML() {
    const text = this.i18n?.watchVideo || 'Continue watching';
    return `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/></svg><span>${text}</span>`;
  }

  bindSafeClick(element, handler) {
    if (!element) return;
    element.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      handler(e);
    });
    element.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
  }

  _forcePause(video) {
    this.debugLog('[Force Pause]: Forcing pause on video ' + this.state.currentVideoId);
    const pause = () => { if (this.state.isTimerActive && !video.paused) video.pause(); };
    pause();
    setTimeout(pause, 50);
  }

  _renderUI(video, skipType, reasonText) {
    document.querySelectorAll('.yt-autoscroll-wrapper').forEach(el => el.remove());
    
    const uiTarget = video.closest('.html5-video-player') || video.parentElement;
    const wrapper = document.createElement('div');
    wrapper.className = 'yt-autoscroll-wrapper';

    // Реклама (ad) и длинные видео (long) используют одну и ту же логику "Продолжить просмотр"
    const isInterruption = skipType === 'long' || skipType === 'ad';
    const btnHTML = isInterruption ? this.getWatchHTML() : this.getWatchAgainHTML();
    
    const iconHTML = isInterruption 
      ? `<g class="ring-icon fill-icon" fill="rgba(255, 255, 255, 0.95)"><path d="M8 5v14l11-7z"/></g>`
      : `<g class="ring-icon stroke-icon" fill="none" stroke="rgba(255, 255, 255, 0.95)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
         </g>`;

    wrapper.innerHTML = `
      <svg class="yt-autoscroll-ring" viewBox="0 0 100 100">
        <circle class="shadow-bg" cx="50" cy="50" r="43"></circle>
        <circle class="bg" cx="50" cy="50" r="46"></circle>
        <circle class="progress" cx="50" cy="50" r="46"></circle>
        <g transform="rotate(90, 50, 50) translate(34, 34) scale(1.33)">
          ${iconHTML}
        </g>
      </svg>
      <div class="yt-autoscroll-control-btn ${isInterruption ? 'resume-mode' : ''}">${btnHTML}</div>
      ${reasonText ? `<div class="yt-autoscroll-reason">${reasonText}</div>` : ''}
    `;

    uiTarget.appendChild(wrapper);

    this.state.activeRing = wrapper.querySelector('.yt-autoscroll-ring');
    this.state.activeBtn = wrapper.querySelector('.yt-autoscroll-control-btn');

    const progress = wrapper.querySelector('.progress');
    progress.style.transitionDuration = `${this.config.delay}ms`;
    requestAnimationFrame(() => requestAnimationFrame(() => { 
      progress.style.strokeDashoffset = "0"; 
    }));
  }

  _bindCancelEvents(video, skipType, targetId) {
    const performTime = Date.now();
    
    video._ytAutoscrollPlayHandler = () => {
      if (Date.now() - performTime < 300) { this._forcePause(video); return; }
      if (!this.state.isTimerActive) return;
      this.cancelSkipAction(video, skipType);
    };
    video.addEventListener('play', video._ytAutoscrollPlayHandler);

    const cancelAction = () => this.cancelSkipAction(video, skipType);
    this.bindSafeClick(this.state.activeRing, cancelAction);
    this.bindSafeClick(this.state.activeBtn, cancelAction);

    this.state.scrollTimeout = setTimeout(() => this.executeSkip(video, targetId), this.config.delay);
  }

  // === ЛОГИКА ПРОПУСКА ===

  executeSkip(video, targetId) {
    if (!targetId || targetId !== this.state.currentVideoId) {
      this.stopEverything();
      return;
    }

    if (video && video._ytAutoscrollPlayHandler) {
      video.removeEventListener('play', video._ytAutoscrollPlayHandler);
      video._ytAutoscrollPlayHandler = null;
    }
    
    this.clearUI();
    this.state.isTimerActive = false;
    this.state.isScrolling = true; // Защищаем checkLoop от новых срабатываний

    if (video && !video.paused) video.pause();
    
    // 1. Делаем первую попытку скролла
    this.triggerScroll();

    // 2. Создаем изолированную функцию-ретрай (Добиватор)
    const retryScroll = () => {
      // Если пользователь сам прокрутил или видео успешно сменилось, isScrolling станет false (сбросится через stopEverything)
      if (!this.state.isScrolling || this.state.currentVideoId !== targetId) return;
      
      this.debugLog('[Retry]: Video stuck, forcing scroll again for ' + targetId);
      if (video && !video.paused) video.pause();
      this.triggerScroll();
      
      // Планируем следующую попытку
      this.state.scrollTimeout = setTimeout(retryScroll, 800);
    };

    // Запускаем первую проверку-добиватор через 2с
    this.state.scrollTimeout = setTimeout(retryScroll, 2000);
  }

  cancelSkipAction(video, skipType) {
    if (video && video._ytAutoscrollPlayHandler) {
      video.removeEventListener('play', video._ytAutoscrollPlayHandler);
      video._ytAutoscrollPlayHandler = null;
    }
    this.clearUI();
    this.state.isTimerActive = false;
    this.state.waitingVideoId = null;
    
    if (video) {
      if (skipType === 'end') {
        video.currentTime = 0;
        video._lastTime = 0;
      }
      video.play();
    }
  }

  performScroll(video, options = {}) {
    const { forceInstant = false, skipType = 'end', reasonText = null } = options;
    const targetId = this.state.currentVideoId;

    if (this.state.isScrolling || this.state.isTimerActive || !targetId) return;

    if (this.config.delay <= 0 || forceInstant) {
      this.debugLog('[Instant Scroll]: Skipping directly without delay for video ' + targetId);
      return this.executeSkip(video, targetId);
    }

    this.state.isTimerActive = true;
    this.state.activeVideo = video;
    this.state.activeSkipType = skipType;
    this.state.waitingVideoId = targetId;

    this._forcePause(video);
    this._renderUI(video, skipType, reasonText);
    this._bindCancelEvents(video, skipType, targetId);
  }

  // === ХЕЛПЕРЫ ДЛЯ CHECKLOOP ===

  _getActiveVideo() {
    const videos = document.getElementsByTagName('video');
    let activeVideo = null;
    let maxVisibleArea = 0;
    
    // Находим видео с наибольшей видимой площадью на экране (защита от дурки разработчиков ютуба)
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const rect = v.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
      const visibleArea = visibleHeight * rect.width;
      if (visibleArea > maxVisibleArea) {
        maxVisibleArea = visibleArea;
        activeVideo = v;
      }
    }
    return activeVideo;
  }

  _handleAd(video, videoId) {
    const container = video.closest(SELECTORS.container);
    if (container && (container.querySelector(SELECTORS.ad) || container.hasAttribute('is-ad'))) {
      
      // ФИКС: Защита от фантомной рекламы (Ghost Ad)
      if (Date.now() - this.state.videoChangedTime < 300) {
         return false;
      }

      if (!this.state.isWaiting && !this.state.skippedBuffer.includes(videoId)) {
        this.debugLog('[Ad]: Advertisement detected, showing timer for ' + videoId);
        
        this.state.skippedBuffer.push(videoId);
        if (this.state.skippedBuffer.length > 50) this.state.skippedBuffer.shift();

        const rawReason = this.i18n?.skipAdReason || 'Advertisement';
        this.performScroll(video, { skipType: 'ad', reasonText: rawReason });
        return true;
      }
      
      if (this.state.activeSkipType === 'ad') {
        return true;
      }
    }
    return false;
  }

  _extractVideoId(video) {
    let id = null;
    const player = video.closest('.html5-video-player');
    if (player?.querySelector(SELECTORS.titleLink)?.href) {
      const match = player?.querySelector(SELECTORS.titleLink).href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (match) id = match[1];
    }
    
    if (!id) {
      const match = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (match) id = match[1];
    }

    const container = video.closest(SELECTORS.container);
    if (id && container && (container.querySelector(SELECTORS.ad) || container.hasAttribute('is-ad'))) {
      id = 'ad-' + id;
    }

    return id;
  }

  _checkVideoEnded(video) {
    const currentTime = video.currentTime;
    const duration = video.duration || 0;
    if (typeof video._lastTime === 'undefined') video._lastTime = currentTime;

    let isEnded = false;
    if (duration > 0) {
      const thresholdEnd = Math.max(duration - 1.5, duration * 0.8);
      const thresholdStart = Math.min(1.5, duration * 0.2);
      if (video._lastTime > thresholdEnd && currentTime < thresholdStart) {
        isEnded = true;
      }
    }
    video._lastTime = currentTime;
    return { isEnded, duration };
  }

  _processSkipLong(video, videoId, duration) {
    if (!this.config.skipEnabled || this.state.isWaiting) return false;

    if (videoId && videoId.startsWith('ad-')) return false;

    if (duration && isFinite(duration) && duration > this.config.skipLimit) {
      if (!this.state.skippedBuffer.includes(videoId)) {
        this.state.skippedBuffer.push(videoId);
        if (this.state.skippedBuffer.length > 50) this.state.skippedBuffer.shift();
        
        const rawReason = this.i18n?.skipReason || 'Longer than {limit} sec';
        const reasonText = rawReason.replace('{limit}', this.config.skipLimit);
        this.performScroll(video, { skipType: 'long', reasonText: reasonText });
        return true;
      }
    }
    return false;
  }

  // === ГЛАВНЫЙ ОРКЕСТРАТОР ===

  checkLoop() {
    const activeVideo = this._getActiveVideo();
    if (!activeVideo || activeVideo.readyState < 2 || this.state.manualScrollBlock) return;

    const videoId = this._extractVideoId(activeVideo);
    if (!videoId) return;

    
    // СМЕНА ВИДЕО: Глушим все таймеры и ретраи
    if (this.state.currentVideoId !== videoId) {
      this.debugLog('[Video Changed]: ' + this.state.currentVideoId + ' -> ' + videoId);
      this.stopEverything(); 
      this.state.currentVideoId = videoId;
      this.state.videoChangedTime = Date.now();
      activeVideo._lastTime = activeVideo.currentTime;
    }
    
    // Если мы прямо сейчас физически листаем (или добиваем зависший скролл) - ждем
    if (this.state.isScrolling) 
      {
        this.debugLog('[CheckLoop]: Currently auto-scrolling, waiting for next check. Video: ' + videoId);
        return;
      }
    
    const { isEnded, duration } = this._checkVideoEnded(activeVideo);
    
    // 1. Обрабатываем рекламу
    if (this._handleAd(activeVideo, videoId)) {
      this.debugLog('[Ad]: AD Handled and scrolled for video ' + videoId);
      return;
    }  
    
    // 2. Обрабатываем пропуск длинных видео
    if (this._processSkipLong(activeVideo, videoId, duration)) {
      this.debugLog('[SkipLong]: Skipping long video ' + videoId);
      return;
    }
    
    // 3. Обычная пауза
    if (activeVideo.paused && !isEnded) {
      this.debugLog('[Pause]: Video is paused by user for video ' + videoId);
      return;
    }
    
    // 4. Конец видео
    if (isEnded && !this.state.isTimerActive) {
      this.debugLog('[Video Ended]: Video ' + videoId + ' ended, performing scroll');
      this.performScroll(activeVideo, { skipType: 'end' });
    }

    this.debugLog('[CheckLoop]: Playing: ' + videoId + ', currentVideoId: ' + this.state.currentVideoId);
  }
}

new YTShortsAutoScroller();