/* Keep YouTube DOM assumptions in one place. */
globalThis.AutoScrollYouTube = {
  container: 'ytd-reel-video-renderer, .reel-video-in-sequence, .reel-video-in-sequence-new',
  likeAction(video) {
    const reel = video?.closest(this.container);
    const like = reel?.querySelector('#like-button, ytd-like-button-renderer, like-button-view-model');
    if (!like) return null;
    // Insert alongside the whole action, outside its clickable area and counter.
    const rail = like.closest('#actions, #button-bar, reel-action-bar-view-model');
    let item = like;
    if (rail && rail !== item) {
      while (item.parentElement !== rail) item = item.parentElement;
    }
    return item;
  },
  isAd(video) {
    const container = video.closest(this.container);
    return Boolean(container && (container.hasAttribute('is-ad') || container.querySelector('ytd-ad-slot-renderer, ad-button-view-model')));
  },
  activeVideo() {
    let best = null;
    let maxArea = 0;
    for (const video of document.querySelectorAll('video')) {
      if (!video.closest(this.container)) continue;
      const rect = video.getBoundingClientRect();
      const width = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
      const height = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
      if (width * height > maxArea) { maxArea = width * height; best = video; }
    }
    return best;
  },
  identity(video) {
    if (!video) return null;
    const container = video.closest(this.container);
    // Arbitrary Shorts links can point to recommendations, not the current video.
    const href = video.closest('.html5-video-player')?.querySelector('.ytp-title-link')?.href;
    const id = container?.getAttribute('video-id') || href?.match(/\/shorts\/([\w-]+)/)?.[1] || location.pathname.match(/\/shorts\/([\w-]+)/)?.[1];
    return id ? `${this.isAd(video) ? 'ad-' : ''}${id}` : null;
  },
  next(video) {
    const button = document.querySelector('#navigation-button-down button, button[aria-label="Next video"]');
    if (button && !button.disabled && button.getClientRects().length) {
      button.click();
    } else {
      video.focus({ preventScroll: true });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
    }
  }
};
