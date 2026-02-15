let config = { 
  enabled: true, 
  delay: 0,
  skipEnabled: false,
  skipLimit: 60
};

// Переменные состояния
let isScrolling = false;
let lastSkippedSrc = ""; 

// --- Загрузка настроек ---
function updateConfig() {
  chrome.storage.local.get(['enabled', 'delay', 'skipEnabled', 'skipLimit'], (res) => {
    if (res.enabled !== undefined) config.enabled = res.enabled;
    if (res.delay !== undefined) config.delay = res.delay;
    if (res.skipEnabled !== undefined) config.skipEnabled = res.skipEnabled;
    if (res.skipLimit !== undefined) config.skipLimit = res.skipLimit;
  });
}
updateConfig();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) config.enabled = changes.enabled.newValue;
  if (changes.delay) config.delay = changes.delay.newValue;
  if (changes.skipEnabled) config.skipEnabled = changes.skipEnabled.newValue;
  if (changes.skipLimit) config.skipLimit = changes.skipLimit.newValue;
});

// --- Логика Скролла ---
const triggerScroll = () => {
  const event = new KeyboardEvent('keydown', {
    key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true
  });
  document.dispatchEvent(event);
  console.log('[Shorts Flow] ⬇ Scrolled');
};

const performScroll = (reason) => {
  if (isScrolling) return;
  isScrolling = true;

  console.log(`[Shorts Flow] Action: ${reason}.`);
  
  // Если задержка > 0, ждем. Если 0 - листаем моментально.
  if (config.delay > 0) {
      setTimeout(() => {
        triggerScroll();
        setTimeout(() => { isScrolling = false; }, 1000);
      }, config.delay);
  } else {
      triggerScroll();
      // Уменьшил время блокировки до 0.5 сек для более быстрой реакции
      setTimeout(() => { isScrolling = false; }, 500); 
  }
};

// --- Главный цикл ---
const checkLoop = () => {
  if (!config.enabled) return;
  // Простая проверка URL (быстрее, чем includes каждый раз, но includes надежнее)
  if (!window.location.href.includes('/shorts/')) return;

  const videos = document.querySelectorAll('video');
  
  videos.forEach(video => {
    // 1. Удаляем LOOP (постоянно, чтобы наверняка)
    if (video.hasAttribute('loop')) {
      video.removeAttribute('loop');
    }

    // Игнорируем видео, которые не активны (на паузе и не закончились)
    // Это важно, чтобы не триггерить на предзагруженные видео
    if (video.paused && !video.ended) return;

    // 2. Проверка: Видео закончилось?
    if (video.ended && !isScrolling) {
        performScroll("Video Ended");
        return;
    }

    // 3. Проверка: Лимит длины
    if (config.skipEnabled && !isScrolling) {
      // Если метаданные еще не подгрузились
      if (!video.duration || Number.isNaN(video.duration)) return;

      // Проверяем, не пытаемся ли мы пропустить то же самое видео (защита от повтора)
      if (video.src === lastSkippedSrc) return;

      if (video.duration > config.skipLimit) {
        console.log(`[Shorts Flow] Too long (${video.duration.toFixed(1)}s). FAST SKIP.`);
        
        // ВАЖНО: Сразу ставим на паузу! 
        // Это уберет звук и движение, пользователь поймет, что видео скипнуто.
        video.pause();
        
        lastSkippedSrc = video.src;
        performScroll("Duration Limit");
      }
    }
  });
};

// УСКОРИЛИ: Теперь проверка каждые 100мс (было 400мс)
// Это сделает реакцию почти мгновенной
setInterval(checkLoop, 100);