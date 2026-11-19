importScripts('settings.js');

const ICONS = { ACTIVE: 'assets/icons/YT-icon-active.png', INACTIVE: 'assets/icons/YT-icon-deactivated.png' };
let revision = 0;
async function refreshIcons() {
  const request = ++revision;
  try {
    const [stored, tabs] = await Promise.all([chrome.storage.local.get(['enabled', 'skipEnabled', 'skipAds']), chrome.tabs.query({})]);
    if (request !== revision) return;
    const enabled = AutoScrollSettings.anyEnabled(AutoScrollSettings.normalize(stored));
    await Promise.all(tabs.map(async tab => {
      const active = enabled && AutoScrollSettings.isShorts(tab.url);
      try { await chrome.action.setIcon({ tabId: tab.id, path: active ? ICONS.ACTIVE : ICONS.INACTIVE }); }
      catch { /* A tab may close while settings are loading. */ }
    }));
  } catch (error) { console.warn('AutoScroll: icon update failed', error); }
}
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === 'complete') refreshIcons();
});
chrome.tabs.onActivated.addListener(refreshIcons);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['enabled', 'skipEnabled', 'skipAds'].some(key => changes[key])) refreshIcons();
});
chrome.runtime.onInstalled.addListener(refreshIcons);
chrome.runtime.onStartup.addListener(refreshIcons);
