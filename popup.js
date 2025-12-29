// Словарь переводов
const translations = {
  ru: {
    autoScroll: "Авто-скролл",
    scrollDesc: "Листать после окончания",
    skipLong: "Лимит длины",
    skipDesc: "Пропускать длинные видео",
    delay: "Задержка между видео",
    skipTimeLabel: "Если длиннее чем", // Изменен текст
    statusReady: "Готов к работе",
    statusSaved: "Настройки сохранены",
    sec: "сек"
  },
  en: {
    autoScroll: "Auto-Scroll",
    scrollDesc: "Scroll on video end",
    skipLong: "Duration Limit",
    skipDesc: "Skip long videos immediately",
    delay: "Delay between videos",
    skipTimeLabel: "If longer than", // Изменен текст
    statusReady: "Ready to work",
    statusSaved: "Settings saved",
    sec: "sec"
  }
};

let currentLang = 'ru';

document.addEventListener('DOMContentLoaded', () => {
  // Элементы
  const toggleScroll = document.getElementById('toggle-scroll');
  const delaySlider = document.getElementById('delay-slider');
  const delayDisplay = document.getElementById('delay-display');
  
  const toggleSkip = document.getElementById('toggle-skip');
  const skipSlider = document.getElementById('skip-slider');
  const skipDisplay = document.getElementById('skip-display');
  const skipContainer = document.getElementById('skip-settings-container');

  const status = document.getElementById('status');
  const btnRu = document.getElementById('btn-ru');
  const btnEn = document.getElementById('btn-en');

  // --- Управление видимостью слайдера пропуска ---
  function updateSkipVisibility() {
    if (toggleSkip.checked) {
      skipContainer.classList.remove('hidden');
    } else {
      skipContainer.classList.add('hidden');
    }
  }

  // --- Функция применения языка ---
  function applyLanguage(lang) {
    currentLang = lang;
    if (lang === 'ru') {
      btnRu.classList.add('active');
      btnEn.classList.remove('active');
    } else {
      btnEn.classList.add('active');
      btnRu.classList.remove('active');
    }

    document.querySelectorAll('[data-lang-key]').forEach(el => {
      const key = el.getAttribute('data-lang-key');
      if (translations[lang][key]) {
        el.textContent = translations[lang][key];
      }
    });

    updateDisplays();
  }

  // --- Обновление цифр ---
  function updateDisplays() {
    const secText = translations[currentLang].sec;
    // Задержка
    delayDisplay.textContent = (delaySlider.value / 1000).toFixed(1) + ' ' + secText;
    // Пропуск
    skipDisplay.textContent = skipSlider.value + ' ' + secText;
  }

  // --- Загрузка настроек ---
  chrome.storage.local.get(['enabled', 'delay', 'language', 'skipEnabled', 'skipLimit'], (result) => {
    // 1. Основной скролл
    toggleScroll.checked = result.enabled !== false;
    delaySlider.value = result.delay !== undefined ? result.delay : 0;
    
    // 2. Пропуск длинных (по дефолту выключен)
    toggleSkip.checked = result.skipEnabled === true;
    skipSlider.value = result.skipLimit || 60; 

    // 3. Язык
    const savedLang = result.language || 'ru';
    
    // Применяем
    updateSkipVisibility();
    applyLanguage(savedLang); 
  });

  // --- Сохранение ---
  function saveSettings() {
    const settings = {
      enabled: toggleScroll.checked,
      delay: parseInt(delaySlider.value, 10),
      skipEnabled: toggleSkip.checked,
      skipLimit: parseInt(skipSlider.value, 10),
      language: currentLang
    };
    
    updateDisplays();
    updateSkipVisibility();

    chrome.storage.local.set(settings, () => {
      status.textContent = translations[currentLang].statusSaved;
      status.classList.add('saved');
      setTimeout(() => {
        status.textContent = translations[currentLang].statusReady;
        status.classList.remove('saved');
      }, 1500);
    });
  }

  // --- Слушатели ---
  btnEn.addEventListener('click', () => { applyLanguage('en'); saveSettings(); });
  btnRu.addEventListener('click', () => { applyLanguage('ru'); saveSettings(); });

  toggleScroll.addEventListener('change', saveSettings);
  delaySlider.addEventListener('input', updateDisplays);
  delaySlider.addEventListener('change', saveSettings);

  toggleSkip.addEventListener('change', saveSettings);
  skipSlider.addEventListener('input', updateDisplays);
  skipSlider.addEventListener('change', saveSettings);
});