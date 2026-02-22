const translations = {
  ru: {
    autoScroll: "Авто-скролл",
    scrollDesc: "Листать после окончания",
    skipLong: "Лимит длительности",
    skipDesc: "Сразу пропускать длинные",
    delay: "Задержка скролла",
    skipTimeLabel: "Пропустить если длиннее чем",
    statusReady: "Готов к работе",
    statusSaved: "Сохранено",
    sec: "сек"
  },
  en: {
    autoScroll: "Auto-Scroll",
    scrollDesc: "Scroll on video end",
    skipLong: "Duration Limit",
    skipDesc: "Skip long immediately",
    delay: "Scroll Delay",
    skipTimeLabel: "Skip if longer than",
    statusReady: "Ready to work",
    statusSaved: "Saved",
    sec: "sec"
  }
};

let currentLang = 'ru';

document.addEventListener('DOMContentLoaded', () => {
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

  function updateSkipVisibility() {
    if (toggleSkip.checked) {
      skipContainer.classList.remove('hidden');
    } else {
      skipContainer.classList.add('hidden');
    }
  }

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

  function updateDisplays() {
    const secText = translations[currentLang].sec;
    delayDisplay.textContent = (delaySlider.value / 1000).toFixed(1) + ' ' + secText;
    skipDisplay.textContent = skipSlider.value + ' ' + secText;
  }

  chrome.storage.local.get(['enabled', 'delay', 'language', 'skipEnabled', 'skipLimit'], (result) => {
    toggleScroll.checked = result.enabled !== false;
    delaySlider.value = result.delay !== undefined ? result.delay : 2000;
    
    toggleSkip.checked = result.skipEnabled === true;
    skipSlider.value = result.skipLimit || 60; 

    const savedLang = result.language || 'ru';
    
    updateSkipVisibility();
    applyLanguage(savedLang); 
  });

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

  btnEn.addEventListener('click', () => { applyLanguage('en'); saveSettings(); });
  btnRu.addEventListener('click', () => { applyLanguage('ru'); saveSettings(); });

  toggleScroll.addEventListener('change', saveSettings);
  delaySlider.addEventListener('input', updateDisplays);
  delaySlider.addEventListener('change', saveSettings);

  toggleSkip.addEventListener('change', saveSettings);
  skipSlider.addEventListener('input', updateDisplays);
  skipSlider.addEventListener('change', saveSettings);
});