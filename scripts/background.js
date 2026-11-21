importScripts('settings.js');

const ICONS = { ACTIVE: 'assets/icons/YT-icon-active.png', INACTIVE: 'assets/icons/YT-icon-deactivated.png' };
let revision = 0;
async function refreshIcons() {
  const request = ++revision;
  try {
    const [stored, tabs] = await Promise.all([chrome.storage.local.get(['enabled']), chrome.tabs.query({})]);
    if (request !== revision) return;
    const enabled = AutoScrollSettings.normalize(stored).enabled;
    await Promise.all(tabs.map(async tab => {
      const active = enabled && AutoScrollSettings.isShorts(tab.url);
      try { await chrome.action.setIcon({ tabId: tab.id, path: active ? ICONS.ACTIVE : ICONS.INACTIVE }); }
      catch { /* A tab may close while settings are loading. */ }
    }));
  } catch (error) { console.warn('AutoScroll: icon update failed', error); }
}

async function connectOpenYouTubeTabs() {
  const [content] = chrome.runtime.getManifest().content_scripts;
  const tabs = await chrome.tabs.query({ url: content.matches });
  await Promise.all(tabs.filter(tab => tab.id != null && !tab.discarded).map(async tab => {
    const target = { tabId: tab.id };
    try {
      const [injection] = await chrome.scripting.executeScript({ target, files: content.js });
      // If the tab navigates during setup, keep the styles in the document that ran the scripts.
      if (injection?.documentId) target.documentIds = [injection.documentId];
      await chrome.scripting.insertCSS({ target, files: content.css });
    } catch (error) {
      console.debug('AutoScroll: could not connect to an open YouTube tab', error);
    }
  }));
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === 'complete') refreshIcons();
});
chrome.tabs.onActivated.addListener(refreshIcons);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) refreshIcons();
});
chrome.runtime.onInstalled.addListener(async ({ reason } = {}) => {
  const icons = refreshIcons();
  if (reason === 'install') {
    try { await connectOpenYouTubeTabs(); }
    catch (error) { console.warn('AutoScroll: open-tab setup failed', error); }
  }
  await icons;
});
chrome.runtime.onStartup.addListener(refreshIcons);
