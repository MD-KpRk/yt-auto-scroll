let config = { 
  enabled: true, 
  delay: 2000,
  skipEnabled: false,
  skipLimit: 60
};

let isScrolling = false;
let lastSkippedSrc = ""; 

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

const triggerScroll = () => {
  const event = new KeyboardEvent('keydown', {
    key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true
  });
  document.dispatchEvent(event);
};

const performScroll = () => {
  if (isScrolling) return;
  isScrolling = true;
  
  if (config.delay > 0) {
    setTimeout(() => {
      triggerScroll();
      setTimeout(() => { isScrolling = false; }, 1000);
    }, config.delay);
  } else {
    triggerScroll();
    setTimeout(() => { isScrolling = false; }, 500); 
  }
};

const checkLoop = () => {
  if (!config.enabled || !window.location.pathname.startsWith('/shorts/')) return;

  const videos = document.getElementsByTagName('video');
  
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    
    if (video.hasAttribute('loop')) {
      video.removeAttribute('loop');
    }

    if (video.paused && !video.ended) continue;

    if (video.ended && !isScrolling) {
      performScroll();
      return;
    }

    if (config.skipEnabled && !isScrolling) {
      if (!video.duration || !isFinite(video.duration)) continue;
      if (video.src === lastSkippedSrc) continue;

      if (video.duration > config.skipLimit) {
        video.pause();
        lastSkippedSrc = video.src;
        performScroll();
      }
    }
  }
};

setInterval(checkLoop, 100);