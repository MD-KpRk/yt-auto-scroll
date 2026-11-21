const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

function setup(config = {}, directEntry = false) {
  let now = 10000, serial = 0, active, advances = 0;
  const timers = new Map();
  class Video extends EventTarget {
    constructor(id = 'one') {
      super(); Object.assign(this, { id, currentTime: 10, duration: 100, currentSrc: 'blob:' + id,
        paused: false, ended: false, seeking: false, readyState: 4, isConnected: true, loop: true, ad: false });
    }
    pause() { this.paused = true; }
    play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  }
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, URL, AbortController, Event,
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { timers.set(++serial, { fn, at: now + delay }); return serial; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { i18n: { getUILanguage: () => 'ru-RU' }, runtime: { onMessage: { addListener() {} } } },
    document: { hidden: false }, location: { href: 'https://www.youtube.com/shorts/one', pathname: '/shorts/one' },
    IntersectionObserver: class { observe() {} disconnect() {} },
    AutoScrollOverlay: class { update() {} remove() {} },
    AutoScrollYouTube: { activeVideo: () => active, likeAction: () => null, identity: video => video?.id || null,
      isAd: video => video.ad, next: () => { advances++; } }
  });
  vm.runInContext(source('scripts/settings.js'), ctx);
  const controllerSource = source('scripts/content.js')
    .replace('void (globalThis.ytShortsAutoScroller ??= new class', 'globalThis.Scroller = class')
    .replace(/\}\(\)\);\s*$/, '};');
  vm.runInContext(controllerSource, ctx);
  const init = ctx.Scroller.prototype.init;
  ctx.Scroller.prototype.init = function () {};
  const scroller = new ctx.Scroller();
  scroller.rawSettings = { ...config };
  scroller.config = ctx.AutoScrollSettings.normalize(config);
  if (!directEntry) {
    // Most playback tests exercise a Short reached by scrolling within a feed.
    ctx.location = new URL('https://www.youtube.com/shorts/intro');
    scroller.refresh();
    ctx.location = new URL('https://www.youtube.com/shorts/one');
  }
  active = new Video();
  scroller.refresh();
  function tick(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = end;
  }
  return { ctx, scroller, init, video: active, Video, timers, tick,
    setActive(video) { active = video; }, get advances() { return advances; } };
}

test('settings validate types, bounds, language and legacy disabled state', () => {
  const { ctx } = setup();
  const result = ctx.AutoScrollSettings.normalize({ enabled: false, delay: 9999, skipLimit: NaN, language: '../bad', extra: 1 });
  assert.equal(result.delay, 3000); assert.equal(result.skipLimit, 60);
  assert.equal(result.language, 'ru'); assert.equal(result.skipAds, false); assert.equal(result.extra, undefined);
  assert.equal(ctx.AutoScrollSettings.normalize({ delay: -4, skipLimit: 999 }).skipLimit, 120);
  assert.equal(ctx.AutoScrollSettings.isShorts('https://evil.test/youtube.com/shorts/one'), false);
});

test('manual navigation cancels countdown, even a queued stale callback', () => {
  const h = setup(); h.scroller.start(h.video, 'end');
  const stale = [...h.timers.values()][0].fn;
  h.scroller.block(); stale(); h.tick(5000);
  assert.equal(h.advances, 0); assert.equal(h.scroller.operation, null); assert.equal(h.video.paused, false);
});

test('manual navigation cancels retries and observes the next video during blocking', () => {
  const h = setup({ delay: 0 }); h.scroller.start(h.video, 'end');
  assert.equal(h.advances, 1); h.scroller.block();
  const next = new h.Video('two'); h.setActive(next); h.scroller.refresh(); h.tick(10000);
  assert.equal(h.scroller.current.video, next); assert.equal(h.advances, 1);
});

test('retry count is bounded and watchdog does not restart failed videos', () => {
  const h = setup({ delay: 0 }); h.video.ended = true; h.video.paused = true; h.scroller.evaluate(true);
  h.tick(20000); h.scroller.refresh();
  assert.equal(h.advances, 3); assert.equal(h.scroller.operation, null); assert.equal(h.timers.size, 0);
});

test('normal ended event works without a loop wrap and original loop is restored', () => {
  const h = setup(); assert.equal(h.video.loop, false);
  h.video.currentTime = h.video.duration; h.video.ended = true; h.video.paused = true;
  h.video.dispatchEvent(new Event('ended')); assert.equal(h.scroller.mode, 'waiting');
  h.tick(1000); assert.equal(h.advances, 1);
  h.scroller.detachVideo(); assert.equal(h.video.loop, true);
});

test('seeking from the end to the beginning is not interpreted as video completion', () => {
  const h = setup(); h.video.currentTime = 99; h.scroller.evaluate();
  h.scroller.current.userSeekUntil = Date.now() + 1500;
  h.video.currentTime = 0; h.video.dispatchEvent(new Event('seeking')); h.scroller.evaluate();
  h.tick(1000); h.scroller.evaluate(); assert.equal(h.scroller.operation, null);
});

test('removed play listeners cannot cancel a later countdown', () => {
  const h = setup(); h.scroller.start(h.video, 'end'); h.scroller.stopOperation();
  const next = new h.Video('two'); h.setActive(next); h.scroller.refresh(); h.scroller.start(next, 'end');
  const pending = h.scroller.operation; h.video.dispatchEvent(new Event('play'));
  assert.equal(h.scroller.operation, pending);
});

test('delay changes replace a countdown without leaving a stale timer', () => {
  const h = setup(); h.scroller.start(h.video, 'end'); h.tick(500);
  h.scroller.settingsChanged({ delay: { newValue: 2000 } });
  assert.equal(h.timers.size, 1); h.tick(1000); assert.equal(h.advances, 0);
  h.tick(1000); assert.equal(h.advances, 1);
});

test('long-video setting works independently and disabling it cancels a countdown', () => {
  const h = setup({ enabled: true, skipEnabled: true, skipAds: false });
  assert.equal(h.scroller.operation.type, 'long');
  h.scroller.settingsChanged({ skipEnabled: { newValue: false } }); h.tick(5000);
  assert.equal(h.advances, 0); assert.equal(h.video.paused, false);
});

test('raising duration limit cancels pending skip and resumes playback', () => {
  const h = setup({ skipEnabled: true });
  h.scroller.settingsChanged({ skipLimit: { newValue: 120 } }); h.tick(5000);
  assert.equal(h.scroller.operation, null); assert.equal(h.video.paused, false); assert.equal(h.advances, 0);
});

test('ads work independently and have a cancellable setting', () => {
  const h = setup({ enabled: true, skipEnabled: false, skipAds: true });
  h.video.ad = true; h.tick(500); h.scroller.refresh();
  assert.equal(h.scroller.operation.type, 'ad');
  h.scroller.settingsChanged({ skipAds: { newValue: false } }); h.tick(5000);
  assert.equal(h.advances, 0);
});

test('manual cancellation does not immediately restart long-video skipping', () => {
  const h = setup({ skipEnabled: true }); h.scroller.cancel(h.scroller.operation);
  h.scroller.refresh(); h.tick(5000); assert.equal(h.scroller.operation, null); assert.equal(h.advances, 0);
});

test('manual blocking cannot restart a skip through synchronous play events', () => {
  const h = setup({ skipEnabled: true }); h.scroller.block();
  assert.equal(h.scroller.operation, null); assert.equal(h.scroller.mode, 'blocked');
});

test('continued long video still scrolls when it eventually ends', () => {
  const h = setup({ skipEnabled: true }); h.scroller.cancel(h.scroller.operation);
  h.video.ended = true; h.video.paused = true; h.video.currentTime = h.video.duration;
  h.scroller.evaluate(true);
  assert.equal(h.scroller.operation.type, 'end');
});

test('URL, element or source changes invalidate a queued action before watchdog runs', () => {
  for (const kind of ['path', 'element', 'source']) {
    const h = setup(); h.scroller.start(h.video, 'end');
    if (kind === 'path') h.ctx.location.pathname = '/shorts/two';
    if (kind === 'element') h.setActive(new h.Video('two'));
    if (kind === 'source') h.video.currentSrc = 'blob:replacement';
    h.tick(1000); assert.equal(h.advances, 0, kind);
  }
});

test('leaving Shorts and hiding a tab both cancel pending actions', () => {
  for (const kind of ['path', 'hidden']) {
    const h = setup(); h.scroller.start(h.video, 'end');
    if (kind === 'path') h.ctx.location.href = 'https://www.youtube.com/watch?v=one';
    else h.ctx.document.hidden = true;
    h.scroller.refresh(); h.tick(5000);
    assert.equal(h.advances, 0); assert.equal(h.scroller.current, null);
  }
});

test('user-paused long videos remain paused without automatic skipping', () => {
  const h = setup(); h.video.paused = true;
  h.scroller.settingsChanged({ skipEnabled: { newValue: true } });
  assert.equal(h.scroller.operation, null); assert.equal(h.video.paused, true);
});

test('active-video selection excludes non-Shorts and horizontally invisible videos', () => {
  const { ctx } = setup();
  const video = (short, rect) => ({ closest: () => short, getBoundingClientRect: () => rect });
  const visible = video(true, { left: 10, right: 300, top: 0, bottom: 400 });
  const outside = video(true, { left: 1200, right: 1800, top: 0, bottom: 1000 });
  const other = video(false, { left: 0, right: 1000, top: 0, bottom: 1000 });
  ctx.innerWidth = 1000; ctx.innerHeight = 1000;
  ctx.document.querySelectorAll = () => [other, outside, visible];
  vm.runInContext(source('scripts/youtube.js'), ctx);
  assert.equal(ctx.AutoScrollYouTube.activeVideo(), visible);
});

test('all JavaScript parses and manifest references existing assets', () => {
  for (const folder of ['scripts', 'popup']) {
    for (const file of fs.readdirSync(path.join(root, folder)).filter(file => file.endsWith('.js'))) {
      new vm.Script(source(`${folder}/${file}`));
    }
  }
  const manifest = JSON.parse(source('manifest.json'));
  for (const content of manifest.content_scripts) {
    for (const file of [...content.js, ...content.css]) assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  const en = JSON.parse(source('_locales/en/messages.json'));
  const ru = JSON.parse(source('_locales/ru/messages.json'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  assert.ok(!source('popup/popup.html').includes('fonts.googleapis.com'));
});


test('rejected playback promises are handled during cancellation', async () => {
  const h = setup({ skipEnabled: true });
  h.video.play = () => Promise.reject(new Error('NotAllowedError'));
  h.scroller.cancel(h.scroller.operation);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.scroller.operation, null);
});

test('stale language loads cannot replace the latest language', async () => {
  const h = setup(); const pending = {};
  h.ctx.AutoScrollSettings.translations = lang => new Promise(resolve => { pending[lang] = resolve; });
  h.scroller.config.language = 'en'; const english = h.scroller.loadLanguage();
  h.scroller.config.language = 'ru'; const russian = h.scroller.loadLanguage();
  pending.ru({ watchAgain: 'Russian' }); await russian;
  pending.en({ watchAgain: 'English' }); await english;
  assert.equal(h.scroller.i18n.watchAgain, 'Russian');
});

test('background icons respond to SPA URLs and independent settings', async () => {
  const handlers = {}, icons = [];
  let stored = { enabled: false, skipAds: false, skipEnabled: false };
  const tabs = [{ id: 1, url: 'https://www.youtube.com/shorts/one' }, { id: 2, url: 'https://www.youtube.com/watch?v=one' }];
  const event = name => ({ addListener: fn => { handlers[name] = fn; } });
  const ctx = vm.createContext({ URL, console, importScripts() {}, chrome: {
    i18n: { getUILanguage: () => 'en' },
    tabs: { query: async () => tabs, onUpdated: event('updated'), onActivated: event('activated') },
    storage: { local: { get: async () => stored }, onChanged: event('settings') },
    runtime: { onInstalled: event('installed'), onStartup: event('startup') },
    action: { setIcon: async icon => { icons.push(icon); } }
  } });
  vm.runInContext(source('scripts/settings.js'), ctx);
  vm.runInContext(source('scripts/background.js'), ctx);
  await handlers.installed();
  assert.ok(icons.every(icon => icon.path.endsWith('deactivated.png')));
  stored.enabled = true;
  handlers.settings({ enabled: { newValue: true } }, 'local');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(icons.at(-2).path, 'assets/icons/YT-icon-active.png');
  assert.equal(icons.at(-1).path, 'assets/icons/YT-icon-deactivated.png');
  tabs[0].url = 'https://www.youtube.com/watch?v=one';
  handlers.updated(1, { url: tabs[0].url });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(icons.at(-2).path, 'assets/icons/YT-icon-deactivated.png');
});


test('YouTube automatic seek to start still triggers scrolling after seeked', () => {
  const h = setup(); h.video.currentTime = 99; h.scroller.evaluate();
  h.video.currentTime = 0; h.video.seeking = true;
  h.video.dispatchEvent(new Event('seeking'));
  assert.equal(h.scroller.current.pendingEnd, true);
  h.video.seeking = false; h.video.dispatchEvent(new Event('seeked'));
  assert.equal(h.scroller.operation.type, 'end');
  h.tick(1000); assert.equal(h.advances, 1);
});

test('startup does not wait for translations to resolve', async () => {
  const h = setup();
  h.ctx.chrome.storage = { local: { get: async () => ({}) }, onChanged: { addListener() {} } };
  h.ctx.window = { addEventListener() {} }; h.ctx.document.addEventListener = () => {};
  let watchdog = false;
  h.ctx.setInterval = () => { watchdog = true; };
  h.ctx.AutoScrollSettings.translations = () => new Promise(() => {});
  await h.init.call(h.scroller);
  assert.equal(watchdog, true);
});

test('script reinjection leaves a single controller and watchdog', async () => {
  const { ctx } = setup();
  let listeners = 0, watchdogs = 0;
  ctx.chrome.runtime.onMessage.addListener = () => { listeners++; };
  ctx.chrome.storage = { local: { get: async () => ({}) }, onChanged: { addListener() {} } };
  ctx.window = { addEventListener() {} };
  ctx.document.addEventListener = () => {};
  ctx.setInterval = () => { watchdogs++; };
  ctx.AutoScrollSettings.translations = async () => ({});
  const script = source('scripts/content.js');
  vm.runInContext(script, ctx);
  const controller = ctx.ytShortsAutoScroller;
  vm.runInContext(script, ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.ytShortsAutoScroller, controller);
  assert.equal(listeners, 1);
  assert.equal(watchdogs, 1);
});

test('install connects existing YouTube tabs, including tabs outside Shorts', async () => {
  const manifest = JSON.parse(source('manifest.json'));
  const [content] = manifest.content_scripts;
  const queries = [], injected = [], styled = [];
  const noopEvent = { addListener() {} };
  let installed;
  const ctx = vm.createContext({ console, importScripts() {}, chrome: {
    runtime: { getManifest: () => manifest, onInstalled: { addListener(fn) { installed = fn; } }, onStartup: noopEvent },
    tabs: { onUpdated: noopEvent, onActivated: noopEvent, async query(filter) {
      queries.push(filter);
      return filter.url ? [
        { id: 1, url: 'https://www.youtube.com/shorts/one' },
        { id: 2, url: 'https://www.youtube.com/watch?v=two' },
        { id: 3, discarded: true }
      ] : [];
    } },
    storage: { local: { get: async () => ({}) }, onChanged: noopEvent },
    scripting: {
      async executeScript({ target, files }) { injected.push([target.tabId, files]); return [{ documentId: `doc-${target.tabId}` }]; },
      async insertCSS({ target, files }) { styled.push([target.tabId, target.documentIds[0], files]); }
    }
  }, AutoScrollSettings: { normalize: data => data, anyEnabled: () => true } });
  vm.runInContext(source('scripts/background.js'), ctx);
  await installed({ reason: 'update' });
  assert.equal(injected.length, 0);
  await installed({ reason: 'install' });
  assert.deepEqual(queries.find(query => query.url).url, content.matches);
  assert.deepEqual(injected, [[1, content.js], [2, content.js]]);
  assert.deepEqual(styled, [[1, 'doc-1', content.css], [2, 'doc-2', content.css]]);
});


test('manual return stays protected beyond two seconds for long, ad and ended videos', () => {
  for (const type of ['long', 'ad', 'end']) {
    const h = setup({ skipEnabled: type === 'long', delay: 0 });
    if (type === 'ad') { h.video.ad = true; h.tick(500); h.scroller.refresh(); }
    if (type === 'end') h.scroller.start(h.video, 'end');
    const next = new h.Video('two'); next.duration = 20;
    h.setActive(next); h.scroller.refresh();
    h.scroller.block(); h.setActive(h.video); h.scroller.refresh();
    const count = h.advances;
    h.tick(10000); h.video.ended = true; h.video.paused = true;
    h.scroller.refresh(); h.video.dispatchEvent(new Event('ended')); h.tick(5000);
    assert.equal(h.advances, count, type);
    assert.equal(h.scroller.status().reason, 'manual-return', type);
    assert.equal(h.video.loop, true, type);
    const third = new h.Video('three'); third.duration = 20;
    h.scroller.block(); h.setActive(third); h.scroller.refresh(); h.tick(2500);
    third.ended = true; third.paused = true; third.dispatchEvent(new Event('ended'));
    assert.equal(h.advances, count + 1, type);
  }
});

test('return protection survives DOM replacement and hidden-tab reattachment', () => {
  const h = setup(); h.setActive(new h.Video('two')); h.scroller.refresh();
  h.scroller.block(); h.setActive(h.video); h.scroller.refresh();
  h.ctx.document.hidden = true; h.scroller.refresh();
  h.ctx.document.hidden = false;
  const replacement = new h.Video('one'); h.setActive(replacement); h.scroller.refresh();
  h.tick(5000); replacement.ended = true; replacement.paused = true; h.scroller.refresh();
  assert.equal(h.scroller.status().reason, 'manual-return'); assert.equal(h.advances, 0);
});

test('automatic navigation to a previously visited video does not set manual-return protection', () => {
  const h = setup({ delay: 0 }); h.setActive(new h.Video('two')); h.scroller.refresh();
  h.scroller.start(h.scroller.current.video, 'end');
  h.setActive(h.video); h.scroller.refresh();
  assert.equal(h.scroller.returnedVideoId, null);
});


test('scrubbing during countdown cancels stale timer without changing position or pause', () => {
  const h = setup(); h.scroller.start(h.video, 'end');
  const stale = [...h.timers.values()][0].fn;
  h.scroller.beginSeek(true);
  h.video.currentTime = 45; h.video.seeking = true;
  h.video.dispatchEvent(new Event('seeking'));
  stale(); h.tick(5000);
  assert.equal(h.video.currentTime, 45); assert.equal(h.video.paused, true);
  assert.equal(h.advances, 0); assert.equal(h.scroller.operation, null);
});

test('long scrub across loop boundary is never treated as automatic replay', () => {
  const h = setup(); h.video.currentTime = 99; h.scroller.evaluate();
  h.scroller.beginSeek(true); h.tick(5000);
  h.video.currentTime = 0; h.video.seeking = true; h.video.dispatchEvent(new Event('seeking'));
  h.video.seeking = false; h.video.dispatchEvent(new Event('seeked'));
  assert.equal(h.scroller.current.pendingEnd, false);
  h.tick(5000); h.scroller.refresh(); assert.equal(h.advances, 0);
  h.scroller.finishSeek(); h.tick(600);
  h.video.currentTime = 100; h.video.ended = true; h.video.paused = true;
  h.video.dispatchEvent(new Event('ended')); h.tick(1000);
  assert.equal(h.advances, 1);
});

test('seeking a long video does not immediately schedule another duration skip', () => {
  const h = setup({ skipEnabled: true }); h.scroller.beginSeek();
  h.video.currentTime = 30; h.video.dispatchEvent(new Event('seeking'));
  h.video.dispatchEvent(new Event('seeked')); h.video.play();
  h.tick(5000); h.scroller.refresh();
  assert.equal(h.scroller.operation, null); assert.equal(h.advances, 0);
  assert.equal(h.video.currentTime, 30); assert.equal(h.video.paused, false);
});

test('play before seeking callback does not rewind to zero', () => {
  const h = setup(); h.scroller.start(h.video, 'end');
  h.video.currentTime = 42; h.video.seeking = true; h.video.play();
  assert.equal(h.video.currentTime, 42); assert.equal(h.scroller.operation, null);
  assert.equal(h.video.paused, false);
});

test('a timer cannot advance while seeking even before seeking callback', () => {
  const h = setup(); h.scroller.start(h.video, 'end');
  h.video.seeking = true; h.tick(1000);
  assert.equal(h.advances, 0); assert.equal(h.scroller.operation, null);
});

test('entry from a direct link, channel or search ignores length only for the selected Short', () => {
  for (const origin of [null, '/@channel/shorts', '/results?search_query=shorts']) {
    const h = setup({ skipEnabled: true, delay: 0 }, true);
    if (origin) {
      h.ctx.location = new URL(origin, 'https://www.youtube.com');
      h.scroller.refresh();
      h.ctx.location = new URL('https://www.youtube.com/shorts/one');
      h.scroller.refresh();
    }
    h.tick(5000);
    h.scroller.refresh();
    assert.equal(h.advances, 0, 'selected long video stays visible');
    h.video.ended = true;
    h.video.paused = true;
    h.video.dispatchEvent(new Event('ended'));
    assert.equal(h.advances, 1, 'normal end still advances');
    h.ctx.location = new URL('https://www.youtube.com/shorts/two');
    h.setActive(new h.Video('two'));
    h.scroller.refresh();
    assert.equal(h.advances, 2, 'duration limit applies to next long video');
  }
});

test('after manual return, scrubbing near the end allows one transition on actual completion', async () => {
  const h = setup({ delay: 0 });
  const handlers = {};
  h.ctx.window = { addEventListener(type, fn) { (handlers[type] ??= []).push(fn); } };
  h.ctx.document.addEventListener = () => {};
  h.ctx.setInterval = () => {};
  h.ctx.chrome.storage = { local: { get: async () => ({ delay: 0 }) }, onChanged: { addListener() {} } };
  h.ctx.AutoScrollSettings.translations = async () => ({});
  await h.init.call(h.scroller);
  h.scroller.start(h.video, 'end');
  h.setActive(new h.Video('two')); h.scroller.refresh();
  h.scroller.block(); h.setActive(h.video); h.scroller.refresh();
  assert.equal(h.scroller.status().reason, 'manual-return');
  const target = { closest: selector => selector.includes('.ytp-progress-bar') ? target : null };
  handlers.pointerdown.forEach(fn => fn({ type: 'pointerdown', isTrusted: true, target }));
  h.video.currentTime = h.video.duration - 0.1;
  h.video.dispatchEvent(new Event('seeking'));
  handlers.pointerup.forEach(fn => fn());
  h.video.dispatchEvent(new Event('seeked'));
  assert.equal(h.video.loop, false);
  assert.equal(h.advances, 1);
  h.video.currentTime = h.video.duration;
  h.video.ended = true; h.video.paused = true;
  h.video.dispatchEvent(new Event('ended'));
  h.tick(2100); h.scroller.refresh();
  assert.equal(h.advances, 2);
});

test('rail and popup share the master setting across tabs and preserve skip preferences', async () => {
  for (const delay of [0, 1000]) {
    const tabs = [setup({ skipEnabled: true, skipAds: true, delay }), setup({ skipEnabled: true, skipAds: true, delay })];
    const save = async patch => {
      for (const tab of tabs) tab.scroller.settingsChanged(Object.fromEntries(
        Object.entries(patch).map(([key, newValue]) => [key, { newValue }])
      ));
    };
    tabs[0].ctx.chrome.storage = { local: { set: save } };
    const counts = tabs.map(tab => tab.advances);
    await tabs[0].scroller.toggleEnabled();
    tabs.forEach((tab, i) => {
      tab.tick(5000);
      assert.equal(tab.scroller.config.enabled, false);
      assert.equal(tab.scroller.status().reason, 'disabled');
      assert.equal(tab.advances, counts[i]);
      assert.equal(tab.scroller.config.skipEnabled, true);
    });
    await save({ enabled: true });
    tabs.forEach((tab, i) => {
      tab.tick(delay);
      assert.equal(tab.scroller.config.enabled, true);
      assert.equal(tab.advances, counts[i] + 1);
    });
  }
});
