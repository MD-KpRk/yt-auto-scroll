let currentLang = 'en';
let translations = {};

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

  // Динамически запрашиваем файл локализации
  async function fetchTranslations(lang) {
    try {
      const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
      const res = await fetch(url);
      const json = await res.json();
      const dict = {};
      for (const key in json) {
        dict[key] = json[key].message;
      }
      return dict;
    } catch (e) {
      console.error('Failed to load translations:', e);
      return null;
    }
  }

  async function applyLanguage(lang) {
    currentLang = lang;
    
    if (lang === 'ru') {
      btnRu.classList.add('active');
      btnEn.classList.remove('active');
    } else {
      btnEn.classList.add('active');
      btnRu.classList.remove('active');
    }

    const dict = await fetchTranslations(lang);
    if (dict) {
      translations = dict;
      document.querySelectorAll('[data-lang-key]').forEach(el => {
        const key = el.getAttribute('data-lang-key');
        if (translations[key]) {
          el.textContent = translations[key];
        }
      });
      updateDisplays();
    }
  }

  function updateDisplays() {
    const secText = translations.sec || (currentLang === 'ru' ? 'сек' : 'sec');
    delayDisplay.textContent = (delaySlider.value / 1000).toFixed(1) + ' ' + secText;
    skipDisplay.textContent = skipSlider.value + ' ' + secText;
  }

  chrome.storage.local.get(['enabled', 'delay', 'language', 'skipEnabled', 'skipLimit'], (result) => {
    toggleScroll.checked = result.enabled !== false;
    delaySlider.value = result.delay !== undefined ? result.delay : 1000;
    
    toggleSkip.checked = result.skipEnabled === true;
    skipSlider.value = result.skipLimit || 60; 

    // Умное автоопределение языка браузера при первом запуске
    let savedLang = result.language;
    if (!savedLang) {
      savedLang = chrome.i18n.getUILanguage().startsWith('ru') ? 'ru' : 'en';
    }
    
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
      status.textContent = translations.statusSaved || 'Saved';
      status.classList.add('saved');
      setTimeout(() => {
        status.textContent = translations.statusReady || 'Ready to work';
        status.classList.remove('saved');
      }, 1500);
    });
  }

  btnEn.addEventListener('click', () => { applyLanguage('en').then(saveSettings); });
  btnRu.addEventListener('click', () => { applyLanguage('ru').then(saveSettings); });

  toggleScroll.addEventListener('change', saveSettings);
  delaySlider.addEventListener('input', updateDisplays);
  delaySlider.addEventListener('change', saveSettings);

  toggleSkip.addEventListener('change', saveSettings);
  skipSlider.addEventListener('input', updateDisplays);
  skipSlider.addEventListener('change', saveSettings);
});