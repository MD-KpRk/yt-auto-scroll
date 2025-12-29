// Пути к картинкам
const ICONS = {
  ACTIVE: 'YT-icon-active.png',
  INACTIVE: 'YT-icon-deactivated.png'
};

// Функция смены иконки
function updateIcon(tabId, url) {
  if (!url) return;

  if (url.includes("youtube.com/shorts/")) {
    // Если мы в шортсах - ставим активную
    chrome.action.setIcon({ path: ICONS.ACTIVE, tabId: tabId });
  } else {
    // Иначе - неактивную
    chrome.action.setIcon({ path: ICONS.INACTIVE, tabId: tabId });
  }
}

// Слушаем обновление вкладок (загрузка страницы)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateIcon(tabId, tab.url);
  }
});

// Слушаем переключение между вкладками
chrome.tabs.onActivated.addListener(activeInfo => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url) {
      updateIcon(activeInfo.tabId, tab.url);
    }
  });
});

// При установке расширения сбрасываем на неактивную
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setIcon({ path: ICONS.INACTIVE });
});