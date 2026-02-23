let config = { 
  enabled: true, 
  delay: 1000,
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

const injectStyles = () => {
  if (document.getElementById('yt-autoscroll-styles')) return;
  const style = document.createElement('style');
  style.id = 'yt-autoscroll-styles';
  style.textContent = `
    .yt-autoscroll-ring {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-90deg);
      width: 90px;
      height: 90px;
      pointer-events: none;
      z-index: 9999;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
      opacity: 1;
      transition: opacity 0.2s ease;
    }
    .yt-autoscroll-ring circle {
      fill: transparent;
      stroke-width: 5;
    }
    .yt-autoscroll-ring .bg {
      stroke: rgba(255, 255, 255, 0.15);
    }
    .yt-autoscroll-ring .progress {
      stroke: #ff0033;
      stroke-dasharray: 289;
      stroke-dashoffset: 289;
      stroke-linecap: round;
    }
  `;
  document.head.appendChild(style);
};

const showProgress = (video, delay) => {
  injectStyles();
  
  const playerContainer = video.closest('.html5-video-player') || video.parentElement;
  
  const oldRing = playerContainer.querySelector('.yt-autoscroll-ring');
  if (oldRing) oldRing.remove();

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("class", "yt-autoscroll-ring");
  svg.setAttribute("viewBox", "0 0 100 100");
  
  const bg = document.createElementNS(svgNs, "circle");
  bg.setAttribute("class", "bg");
  bg.setAttribute("cx", "50");
  bg.setAttribute("cy", "50");
  bg.setAttribute("r", "46");
  
  const progress = document.createElementNS(svgNs, "circle");
  progress.setAttribute("class", "progress");
  progress.setAttribute("cx", "50");
  progress.setAttribute("cy", "50");
  progress.setAttribute("r", "46");
  
  svg.appendChild(bg);
  svg.appendChild(progress);
  playerContainer.appendChild(svg);
  
  progress.style.transition = `stroke-dashoffset ${delay}ms linear`;
  
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progress.style.strokeDashoffset = "0";
    });
  });
  
  setTimeout(() => {
    svg.style.opacity = "0";
    setTimeout(() => svg.remove(), 200);
  }, delay);
};

const performScroll = (video) => {
  if (isScrolling) return;
  isScrolling = true;
  
  if (config.delay > 0) {
    if (video) {
      showProgress(video, config.delay);
    }
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
      performScroll(video);
      return;
    }

    if (config.skipEnabled && !isScrolling) {
      if (!video.duration || !isFinite(video.duration)) continue;
      if (video.src === lastSkippedSrc) continue;

      if (video.duration > config.skipLimit) {
        video.pause();
        lastSkippedSrc = video.src;
        performScroll(video);
      }
    }
  }
};

setInterval(checkLoop, 100);