const ICONS = {
  ACTIVE: 'YT-icon-active.png',
  INACTIVE: 'YT-icon-deactivated.png'
};

function updateIcon(tabId, url) {
  if (!url) return;
  const path = url.includes("youtube.com/shorts/") ? ICONS.ACTIVE : ICONS.INACTIVE;
  chrome.action.setIcon({ path, tabId });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateIcon(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(activeInfo => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    updateIcon(activeInfo.tabId, tab.url);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setIcon({ path: ICONS.INACTIVE });
});