let config = { 
  enabled: true, 
  delay: 0,
  skipEnabled: false,
  skipLimit: 60
};

// --- Синхронизация настроек ---
chrome.storage.local.get(['enabled', 'delay', 'skipEnabled', 'skipLimit'], (res) => {
  if (res.enabled !== undefined) config.enabled = res.enabled;
  if (res.delay !== undefined) config.delay = res.delay;
  if (res.skipEnabled !== undefined) config.skipEnabled = res.skipEnabled;
  if (res.skipLimit !== undefined) config.skipLimit = res.skipLimit;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) config.enabled = changes.enabled.newValue;
  if (changes.delay) config.delay = changes.delay.newValue;
  if (changes.skipEnabled) config.skipEnabled = changes.skipEnabled.newValue;
  if (changes.skipLimit) config.skipLimit = changes.skipLimit.newValue;
});

// --- Скролл ---
const triggerScroll = () => {
  console.log('[Shorts Flow] Triggering scroll...');
  const event = new KeyboardEvent('keydown', {
    key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true
  });
  document.dispatchEvent(event);
};

// Функция отложенного скролла (с защитой от двойного срабатывания)
let isScrolling = false;

const performScroll = () => {
  if (isScrolling) return;
  isScrolling = true;

  console.log(`[Shorts Flow] Next in ${config.delay}ms`);
  
  setTimeout(() => {
    triggerScroll();
    // Сбрасываем флаг чуть позже, чтобы успела пройти анимация
    setTimeout(() => { isScrolling = false; }, 1000);
  }, config.delay);
};

// --- Логика проверки длительности ---
const checkDurationAndSkip = (video) => {
  if (!config.enabled || !config.skipEnabled || isScrolling) return;
  if (!window.location.href.includes('/shorts/')) return;
  
  // Если метаданные (длина) еще не загрузились, duration будет NaN
  if (Number.isNaN(video.duration)) return;

  // Если видео длиннее лимита
  if (video.duration > config.skipLimit) {
    console.log(`[Shorts Flow] Video too long (${video.duration.toFixed(1)}s > ${config.skipLimit}s). Skipping immediately.`);
    performScroll();
  }
};

// --- Обработчики событий ---

// 1. Обычное окончание видео
const onVideoEnded = (e) => {
  if (!config.enabled) return;
  if (!window.location.href.includes('/shorts/')) return;
  
  // Если мы уже пропустили его из-за длины, ничего не делаем
  if (isScrolling) return;

  performScroll();
};

// 2. Старт воспроизведения (проверяем длину)
const onVideoPlay = (e) => {
  const video = e.target;
  checkDurationAndSkip(video);
};

// 3. Загрузка метаданных (на случай, если play сработал раньше загрузки длины)
const onMetadataLoaded = (e) => {
  const video = e.target;
  // Проверяем, играет ли видео сейчас (чтобы не скипать предзагруженные видео снизу)
  if (!video.paused) {
    checkDurationAndSkip(video);
  }
};

// --- Процессор видео (ищет новые видео на странице) ---
const processVideos = () => {
  if (!window.location.href.includes('/shorts/')) return;

  const videos = document.querySelectorAll('video');
  
  videos.forEach(video => {
    // Убираем loop, чтобы работало окончание видео
    if (video.hasAttribute('loop')) {
      video.removeAttribute('loop');
    }

    // Если мы уже инициализировали это видео, пропускаем
    if (video.dataset.shortsFlowInit) return;
    video.dataset.shortsFlowInit = 'true';

    // Слушаем конец видео
    video.addEventListener('ended', onVideoEnded);
    
    // Слушаем старт видео (для пропуска по длине)
    video.addEventListener('play', onVideoPlay);
    
    // Слушаем загрузку данных о длине (для надежности)
    video.addEventListener('loadedmetadata', onMetadataLoaded);
  });
};

// Запуск интервала проверки
setInterval(processVideos, 1000);