let config = { 
  enabled: true, 
  delay: 1000,
  skipEnabled: false,
  skipLimit: 60,
  language: 'ru'
};

let isScrolling = false;
let isWaiting = false;
let isPausedByUser = false; 
let scrollTimeout = null;
let activeRing = null;
let activeBtn = null;
let lastSkippedSrc = ""; 
let currentVideoSrc = ""; 

function updateConfig() {
  chrome.storage.local.get(['enabled', 'delay', 'skipEnabled', 'skipLimit', 'language'], (res) => {
    if (res.enabled !== undefined) config.enabled = res.enabled;
    if (res.delay !== undefined) config.delay = res.delay;
    if (res.skipEnabled !== undefined) config.skipEnabled = res.skipEnabled;
    if (res.skipLimit !== undefined) config.skipLimit = res.skipLimit;
    if (res.language !== undefined) config.language = res.language;
  });
}
updateConfig();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) config.enabled = changes.enabled.newValue;
  if (changes.delay) config.delay = changes.delay.newValue;
  if (changes.skipEnabled) config.skipEnabled = changes.skipEnabled.newValue;
  if (changes.skipLimit) config.skipLimit = changes.skipLimit.newValue;
  if (changes.language) config.language = changes.language.newValue;
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
      z-index: 9999;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.4));
      opacity: 1;
      transition: opacity 0.2s ease;
      pointer-events: none; 
    }
    .yt-autoscroll-ring circle {
      fill: transparent;
      stroke-width: 5;
    }
    .yt-autoscroll-ring .bg {
      stroke: rgba(255, 255, 255, 0.15);
    }
    .yt-autoscroll-ring .progress {
      stroke: #ff0000;
      stroke-dasharray: 289;
      stroke-dashoffset: 289;
      stroke-linecap: round;
      transition-property: stroke-dashoffset;
      transition-timing-function: linear;
    }
    .yt-autoscroll-control-btn {
      position: absolute;
      top: calc(50% + 70px);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #fff;
      font-family: "Roboto", "Arial", sans-serif;
      font-size: 14px;
      font-weight: 500;
      padding: 10px 20px 10px 16px;
      border-radius: 36px;
      border: none;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
      pointer-events: auto;
      white-space: nowrap;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .yt-autoscroll-control-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: translateX(-50%) scale(1.03);
    }
    .yt-autoscroll-control-btn svg {
      margin-top: -1px;
    }
    .yt-autoscroll-control-btn.resume-mode {
      background: rgba(0, 0, 0, 0.7);
    }
    .yt-autoscroll-control-btn.resume-mode:hover {
      background: rgba(255, 0, 0, 0.9);
      box-shadow: 0 4px 16px rgba(255, 0, 0, 0.4);
    }
  `;
  document.head.appendChild(style);
};

// Генерация HTML с красивыми SVG иконками
const getCancelHTML = () => {
  const text = config.language === 'en' ? 'Cancel Auto-Scroll' : 'Отменить авто-скролл';
  return `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
    </svg>
    <span>${text}</span>
  `;
};

const getResumeHTML = () => {
  const text = config.language === 'en' ? 'Resume Auto-Scroll' : 'Продолжить авто-скролл';
  return `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M8 5v14l11-7z"/>
    </svg>
    <span>${text}</span>
  `;
};

const performScroll = (video, forceInstant = false) => {
  if (isScrolling || isWaiting || isPausedByUser) return;
  
  if (config.delay > 0 && !forceInstant) {
    isWaiting = true;
    video.pause(); 

    injectStyles();
    const playerContainer = video.closest('.html5-video-player') || video.parentElement;
    
    playerContainer.querySelectorAll('.yt-autoscroll-ring, .yt-autoscroll-control-btn').forEach(el => el.remove());

    const svgNs = "http://www.w3.org/2000/svg";
    activeRing = document.createElementNS(svgNs, "svg");
    activeRing.setAttribute("class", "yt-autoscroll-ring");
    activeRing.setAttribute("viewBox", "0 0 100 100");

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
    
    activeRing.appendChild(bg);
    activeRing.appendChild(progress);
    playerContainer.appendChild(activeRing);

    activeBtn = document.createElement('div');
    activeBtn.className = 'yt-autoscroll-control-btn';
    activeBtn.innerHTML = getCancelHTML();
    playerContainer.appendChild(activeBtn);
    
    progress.style.transitionDuration = `${config.delay}ms`;
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        progress.style.strokeDashoffset = "0";
      });
    });
    
    const doSkip = () => {
      clearTimeout(scrollTimeout);
      if (activeRing) { activeRing.remove(); activeRing = null; }
      if (activeBtn) { activeBtn.remove(); activeBtn = null; }
      isWaiting = false;
      isScrolling = true;
      triggerScroll();
      setTimeout(() => { isScrolling = false; }, 800);
    };

    const onManualPlay = () => {
      if (!isWaiting) return; 
      clearTimeout(scrollTimeout);
      if (activeRing) { activeRing.remove(); activeRing = null; }
      if (activeBtn) { activeBtn.remove(); activeBtn = null; }
      isWaiting = false;
    };
    video.addEventListener('play', onManualPlay, { once: true });

    activeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      clearTimeout(scrollTimeout);
      if (activeRing) {
        activeRing.remove();
        activeRing = null;
      }
      
      isWaiting = false;
      isPausedByUser = true;
      
      activeBtn.innerHTML = getResumeHTML();
      activeBtn.classList.add('resume-mode');
      
      activeBtn.onmousedown = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        activeBtn.remove();
        isPausedByUser = false;
        
        isScrolling = true;
        triggerScroll();
        setTimeout(() => { isScrolling = false; }, 500); 
      };
    });

    scrollTimeout = setTimeout(() => {
      doSkip();
    }, config.delay);

  } else {
    isScrolling = true;
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

    if ((!video.paused || video.ended) && currentVideoSrc !== video.src) {
      currentVideoSrc = video.src;
      isPausedByUser = false;
      isWaiting = false;
      clearTimeout(scrollTimeout);
      document.querySelectorAll('.yt-autoscroll-ring, .yt-autoscroll-control-btn').forEach(el => el.remove());
    }

    if (currentVideoSrc !== video.src) continue;

    if (isPausedByUser) {
      const btn = document.querySelector('.yt-autoscroll-control-btn.resume-mode');
      if (btn) {
        if (!video.paused && !video.ended) {
          btn.style.opacity = '0';
          btn.style.pointerEvents = 'none';
        } else {
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
        }
      }
      continue; 
    }

    if (video.paused && !video.ended) continue;

    if (video.ended && !isScrolling && !isWaiting) {
      performScroll(video, false);
      return;
    }

    if (config.skipEnabled && !isScrolling && !isWaiting) {
      if (!video.duration || !isFinite(video.duration)) continue;
      if (video.src === lastSkippedSrc) continue;

      if (video.duration > config.skipLimit) {
        video.pause();
        lastSkippedSrc = video.src;
        performScroll(video, true);
      }
    }
  }
};

setInterval(checkLoop, 100);