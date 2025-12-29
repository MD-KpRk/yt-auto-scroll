let config = { 
  enabled: true, 
  delay: 0,
  skipEnabled: false,
  skipLimit: 60
};

// Переменные состояния
let isScrolling = false;
let lastSkippedSrc = ""; // Запоминаем ссылку последнего пропущенного видео

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
  // Посылаем сигнал нажатия стрелки вниз
  const event = new KeyboardEvent('keydown', {
    key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true
  });
  document.dispatchEvent(event);
  console.log('[Shorts Flow] ⬇ Scrolled');
};

const performScroll = (reason) => {
  if (isScrolling) return;
  isScrolling = true;

  console.log(`[Shorts Flow] Action: ${reason}. Waiting ${config.delay}ms`);
  
  // Если есть задержка - ждем, если нет - сразу
  if (config.delay > 0) {
      setTimeout(() => {
        triggerScroll();
        setTimeout(() => { isScrolling = false; }, 1000); // Блокировка на время анимации
      }, config.delay);
  } else {
      triggerScroll();
      // При нулевой задержке блокировка короче, но нужна, чтобы не проскочить 2 видео
      setTimeout(() => { isScrolling = false; }, 800); 
  }
};

// --- Обработчик окончания видео ---
// Мы не вешаем это через addEventListener, чтобы не дублировать логику.
// Мы проверяем ended свойство в цикле.
const checkVideoEnded = (video) => {
    if (video.ended) {
        performScroll("Video Ended");
    }
};

// --- Главный цикл проверки (Running Heartbeat) ---
const checkLoop = () => {
  if (!config.enabled) return;
  if (!window.location.href.includes('/shorts/')) return;

  const videos = document.querySelectorAll('video');
  
  videos.forEach(video => {
    // 1. АГРЕССИВНО удаляем loop.
    // YouTube пытается вернуть этот атрибут при каждом переключении, 
    // поэтому мы удаляем его в каждом цикле, а не один раз.
    if (video.hasAttribute('loop')) {
      video.removeAttribute('loop');
    }

    // Мы работаем только с активным (играющим) видео или только что закончившимся
    // Игнорируем предзагруженные видео (которые paused)
    if (video.paused && !video.ended) return;

    // 2. Проверка: Видео закончилось?
    if (video.ended && !isScrolling) {
        performScroll("Video Ended");
        return;
    }

    // 3. Проверка: Лимит длины
    if (config.skipEnabled && !isScrolling) {
      // Если длительность еще не известна
      if (!video.duration || Number.isNaN(video.duration)) return;

      // Сравниваем URL. Если мы уже пропустили ИМЕННО ЭТУ ссылку, не пытаемся снова.
      // Это решает проблему "переиспользования" плеера.
      if (video.src === lastSkippedSrc) return;

      if (video.duration > config.skipLimit) {
        console.log(`[Shorts Flow] Too long (${video.duration.toFixed(1)}s). Skipping.`);
        
        lastSkippedSrc = video.src; // Запоминаем "плохую" ссылку
        performScroll("Duration Limit");
      }
    }
  });
};

// Запускаем проверку часто (каждые 400мс), чтобы интерфейс был отзывчивым
setInterval(checkLoop, 400);