globalThis.AutoScrollOverlay = class {
  constructor(video, type, dictionary, limit, delay, cancel) {
    this.type = type;
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'yt-autoscroll-wrapper';
    this.wrapper.innerHTML = `
      <button type="button" class="yt-autoscroll-ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="shadow-bg" cx="50" cy="50" r="43"></circle>
          <circle class="bg" cx="50" cy="50" r="46"></circle>
          <circle class="progress" cx="50" cy="50" r="46"></circle>
          <g transform="rotate(90, 50, 50)"><path class="ring-icon fill-icon" fill="white" d="M40 30v40l30-20z"></path></g>
        </svg>
      </button>
      <button type="button" class="yt-autoscroll-control-btn"></button>
      <div class="yt-autoscroll-reason"></div>`;
    this.ring = this.wrapper.querySelector('.yt-autoscroll-ring');
    this.button = this.wrapper.querySelector('.yt-autoscroll-control-btn');
    this.reason = this.wrapper.querySelector('.yt-autoscroll-reason');
    this.progress = this.wrapper.querySelector('.progress');
    this.update(dictionary, limit);
    this.events = new AbortController();
    for (const event of ['pointerdown', 'mousedown', 'touchstart', 'keydown']) {
      this.wrapper.addEventListener(event, event => event.stopPropagation(), { signal: this.events.signal });
    }
    for (const button of [this.ring, this.button]) {
      button.addEventListener('click', event => { event.stopPropagation(); cancel(); }, { signal: this.events.signal });
    }
    (video.closest('.html5-video-player') || video.parentElement).appendChild(this.wrapper);
    this.progress.style.transitionDuration = `${delay}ms`;
    this.frame = requestAnimationFrame(() => {
      this.frame = requestAnimationFrame(() => { this.progress.style.strokeDashoffset = '0'; });
    });
  }

  update(dictionary, limit) {
    const label = this.type === 'end' ? dictionary.watchAgain || 'Watch again' : dictionary.watchVideo || 'Continue watching';
    this.ring.setAttribute('aria-label', label);
    this.button.textContent = label;
    this.reason.hidden = this.type === 'end';
    this.reason.textContent = this.type === 'ad' ? dictionary.skipAdReason || 'Advertisement'
      : (dictionary.skipReason || 'Longer than {limit} sec').replace('{limit}', limit);
  }

  remove() {
    cancelAnimationFrame(this.frame);
    this.events.abort();
    this.wrapper.remove();
  }
};
