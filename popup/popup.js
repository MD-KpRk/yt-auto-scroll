document.addEventListener('DOMContentLoaded', async () => {
  const byId = id => document.getElementById(id);
  const controls = {
    enabled: byId('toggle-scroll'), skipEnabled: byId('toggle-skip'), skipAds: byId('toggle-ads'),
    delay: byId('delay-slider'), skipLimit: byId('skip-slider')
  };
  const status = byId('status');
  const languageButtons = { en: byId('btn-en'), ru: byId('btn-ru') };
  let config = AutoScrollSettings.normalize();
  let dictionary = {};
  let languageRequest = 0;
  let statusTimer;
  let statusKey = 'statusReady';
  let writes = Promise.resolve();
  let connectionKey = 'connectionChecking';
  let connectionDetails = '';
  let connectionReason = '';

  function renderConnection() {
    const reason = connectionReason ? (dictionary[connectionReason] || chrome.i18n.getMessage(connectionReason)) : '';
    byId('connection-status').textContent = (dictionary[connectionKey] || chrome.i18n.getMessage(connectionKey)) + connectionDetails + (reason ? ` — ${reason}` : '');
  }

  async function checkConnection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!AutoScrollSettings.isShorts(tab?.url)) connectionKey = 'connectionNotShorts';
      else {
        const health = await chrome.tabs.sendMessage(tab.id, { type: 'YT_AUTOSCROLL_STATUS' });
        if (!health?.version) throw new Error('No content script response');
        connectionKey = 'connectionReady';
        connectionDetails = ` (${health.version})`;
        connectionReason = {
          'no-video': 'connectionNoVideo', 'disabled': 'connectionDisabled',
          'paused': 'connectionPaused', 'retries-exhausted': 'connectionFailed',
          'manual-return': 'connectionManualReturn'
        }[health.reason] || '';
      }
    } catch { connectionKey = 'connectionMissing'; }
    renderConnection();
  }

  function showStatus(key) {
    statusKey = key;
    status.textContent = dictionary[key] || chrome.i18n.getMessage(key) || key;
    status.classList.toggle('saved', key === 'statusSaved');
    status.classList.toggle('error', key === 'statusError' || key === 'statusLoadError');
  }

  function renderValues() {
    const seconds = dictionary.sec || 'sec';
    byId('delay-display').textContent = `${(Number(controls.delay.value) / 1000).toFixed(1)} ${seconds}`;
    byId('skip-display').textContent = `${controls.skipLimit.value} ${seconds}`;
    controls.delay.setAttribute('aria-valuetext', byId('delay-display').textContent);
    controls.skipLimit.setAttribute('aria-valuetext', byId('skip-display').textContent);
    byId('skip-settings-container').classList.toggle('hidden', !controls.skipEnabled.checked);
  }

  async function applyLanguage(language) {
    const request = ++languageRequest;
    document.documentElement.lang = language;
    for (const [lang, button] of Object.entries(languageButtons)) {
      button.classList.toggle('active', lang === language);
      button.setAttribute('aria-pressed', String(lang === language));
    }
    try {
      const loaded = await AutoScrollSettings.translations(language);
      if (request !== languageRequest) return;
      dictionary = loaded;
    } catch (error) {
      if (request !== languageRequest) return;
      console.error('AutoScroll: translation load failed', error);
      dictionary = {};
    }
    document.querySelectorAll('[data-lang-key]').forEach(element => {
      const key = element.dataset.langKey;
      element.textContent = dictionary[key] || chrome.i18n.getMessage(key) || element.textContent;
    });
    renderValues();
    showStatus(statusKey);
    renderConnection();
  }

  function save(patch) {
    clearTimeout(statusTimer);
    // Serialize changes, and write only the edited fields to avoid overwriting another popup.
    writes = writes.then(async () => {
      try {
        await chrome.storage.local.set(patch);
        showStatus('statusSaved');
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => showStatus('statusReady'), 1500);
      } catch (error) {
        clearTimeout(statusTimer);
        showStatus('statusError');
        console.error('AutoScroll: save failed', error);
      }
    });
  }

  const allControls = [...Object.values(controls), ...Object.values(languageButtons)];
  allControls.forEach(control => { control.disabled = true; });
  try {
    config = AutoScrollSettings.normalize(await chrome.storage.local.get(Object.keys(config)));
  } catch (error) {
    await applyLanguage(config.language);
    showStatus('statusLoadError');
    console.error('AutoScroll: load failed', error);
    return;
  }
  for (const [key, control] of Object.entries(controls)) {
    if (control.type === 'checkbox') control.checked = config[key];
    else control.value = config[key];
    control.addEventListener('input', renderValues);
    control.addEventListener('change', () => {
      config = AutoScrollSettings.normalize({ ...config, [key]: control.type === 'checkbox' ? control.checked : Number(control.value) });
      // Materialize the legacy ad default before changing the independent end-scroll switch.
      save(key === 'enabled' ? { enabled: config.enabled, skipAds: config.skipAds } : { [key]: config[key] });
      renderValues();
    });
  }
  for (const [language, button] of Object.entries(languageButtons)) {
    button.addEventListener('click', () => {
      config.language = language;
      applyLanguage(language);
      save({ language });
    });
  }
  await applyLanguage(config.language);
  allControls.forEach(control => { control.disabled = false; });
  checkConnection();
});
