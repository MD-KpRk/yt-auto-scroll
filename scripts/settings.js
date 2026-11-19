/* Shared by the popup, content script and service worker. */
globalThis.AutoScrollSettings = (() => {
  const defaultLanguage = () => chrome.i18n.getUILanguage().toLowerCase().startsWith('ru') ? 'ru' : 'en';
  const number = (value, fallback, min, max, step = 1) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value / step) * step)) : fallback;

  function normalize(data = {}) {
    return {
      enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
      delay: number(data.delay, 1000, 0, 3000, 100),
      skipEnabled: data.skipEnabled === true,
      skipLimit: number(data.skipLimit, 60, 5, 120),
      // Preserve the old disabled state until the independent ad setting is saved.
      skipAds: typeof data.skipAds === 'boolean' ? data.skipAds : data.enabled !== false,
      language: ['ru', 'en'].includes(data.language) ? data.language : defaultLanguage()
    };
  }

  const cache = new Map();
  async function translations(language) {
    const lang = ['ru', 'en'].includes(language) ? language : defaultLanguage();
    if (!cache.has(lang)) {
      cache.set(lang, fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`))
        .then(response => {
          if (!response.ok) throw new Error(`Translation load failed: ${response.status}`);
          return response.json();
        })
        .then(data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.message])))
        .catch(error => { cache.delete(lang); throw error; }));
    }
    return cache.get(lang);
  }

  const isShorts = url => {
    try {
      const parsed = new URL(url);
      return ['https:', 'http:'].includes(parsed.protocol) && parsed.hostname === 'www.youtube.com' && /^\/shorts\/[^/]+/.test(parsed.pathname);
    } catch { return false; }
  };
  return { normalize, translations, isShorts, anyEnabled: config => config.enabled || config.skipEnabled || config.skipAds };
})();
