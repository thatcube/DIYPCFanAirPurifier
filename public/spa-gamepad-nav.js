// Gamepad navigation for the menu pages (home / about / leaderboard /
// settings). Auto-detects the first connected pad and lets it drive
// focus + click() on whatever interactive elements live on the current
// page, so you can browse the splash screen and tabs without leaving
// the controller. Polling is suspended while the iframe has been
// promoted into play (body.is-playing) — the iframe's own gamepad
// handler in src/modules/game-fp.js owns input there. Once the user
// fully navigates to /play (separate document) the parent page
// unloads and this script goes with it; the in-game handler takes
// over with no overlap.
//
// Mapping (W3C Standard Gamepad layout):
//   Left stick / D-pad  →  2D directional focus, scrolls the page
//                          when no candidate exists in that direction
//   Left stick (range)  →  adjusts a focused range input
//   Right stick Y       →  page scroll (handy on the leaderboard)
//   A (button 0)        →  click() the focused element
//   B (button 1)        →  close active dialog → else go home
//   LB / RB             →  cycle prev / next tab
//   Start               →  click [data-play-cta] if present
//
// Idempotent: re-loading is a no-op once installed. Listeners persist
// across SPA swaps because the SPA router only replaces <main>.

(function () {
  if (window.__spaGamepadNavInstalled) return;
  window.__spaGamepadNavInstalled = true;

  // ── Tunables ────────────────────────────────────────────────────
  const DIR_THRESHOLD = 0.55;     // post-deadzone stick level that counts as a press
  const REPEAT_INITIAL_MS = 380;  // first autorepeat after this many ms held
  const REPEAT_INTERVAL_MS = 110; // then once every this many ms
  const SCROLL_DEADZONE = 0.20;
  const SCROLL_PX_PER_SEC = 1400;

  // Standard mapping button indices (Xbox-style names).
  const GP_A = 0, GP_B = 1;
  const GP_LB = 4, GP_RB = 5;
  const GP_START = 9;
  const GP_DUP = 12, GP_DDOWN = 13, GP_DLEFT = 14, GP_DRIGHT = 15;

  // Visible, non-disabled, non-aria-hidden interactives.
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  // ── State ───────────────────────────────────────────────────────
  let activeIdx = -1;
  let rafId = 0;
  let lastPollTs = 0;
  const prevPressed = {};
  const dirLatch = { up: false, down: false, left: false, right: false };
  const dirHoldStart = { up: 0, down: 0, left: 0, right: 0 };
  const dirLastRepeat = { up: 0, down: 0, left: 0, right: 0 };

  // ── Focus helpers ───────────────────────────────────────────────
  function isVisible(el) {
    if (!el) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    // offsetParent is null for display:none chains (covers most
    // hidden cases). Position:fixed elements have null offsetParent
    // but the bounding rect check above already filtered them.
    if (el.offsetParent === null) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') return false;
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  function getFocusables() {
    const all = document.querySelectorAll(FOCUSABLE_SELECTOR);
    const out = [];
    for (const el of all) if (isVisible(el)) out.push(el);
    return out;
  }

  function focusEl(el) {
    if (!el || typeof el.focus !== 'function') return;
    try {
      // focusVisible: true forces the focus ring even when the
      // browser's :focus-visible heuristic would normally suppress
      // it (e.g. .focus() right after a mouse click). Firefox 119+
      // honors it; other browsers ignore the option silently and
      // fall back to their heuristic, which works fine right after
      // a real gamepad button press anyway.
      el.focus({ focusVisible: true, preventScroll: true });
    } catch {
      try { el.focus(); } catch { /* element gone */ }
    }
    // Bring it into view if it's off-screen. Use 'auto' so it doesn't
    // fight the right-stick scroll loop with a smooth animation.
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight
        || r.left < 0 || r.right > window.innerWidth) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { }
    }
  }

  function rectCenter(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Character-select has an asymmetric bottom row: three mode pills
  // above one centered CTA. Pure geometry makes Down from side pills
  // miss the CTA cone, so define explicit edges here.
  function focusCharSelectEdge(current, dir) {
    const picker = document.getElementById('charSelect');
    if (!picker || !picker.classList.contains('open') || !isVisible(picker)) return false;

    const startBtn = picker.querySelector('.char-start');
    if (!startBtn || !isVisible(startBtn)) return false;

    const modePill = current && typeof current.closest === 'function'
      ? current.closest('.mode-pill')
      : null;

    if (modePill && dir === 'down') {
      focusEl(startBtn);
      return true;
    }

    if (current === startBtn && dir === 'up') {
      const activePill = picker.querySelector('.mode-pill.on');
      const fallbackPill = picker.querySelector('.mode-pill');
      const target = (activePill && isVisible(activePill)) ? activePill : fallbackPill;
      if (target && isVisible(target)) {
        focusEl(target);
        return true;
      }
    }

    return false;
  }

  // 2D nearest-in-direction picker. Restricted to a ~45° cone around
  // the requested direction (so "left" never picks an above-and-left
  // element — the user perceives that as the press going UP). Within
  // the cone, score = primary + secondary*2 prefers closer/aligned
  // candidates first.
  function focusInDirection(dir) {
    const focusables = getFocusables();
    if (focusables.length === 0) return false;

    const current = document.activeElement;
    const isCurrentFocusable = current && focusables.indexOf(current) !== -1;

    if (!isCurrentFocusable) {
      // No focus yet — pick the most prominent CTA first, then the
      // active tab, then any focusable. This is also how we initially
      // land focus when the pad first connects.
      const cta = document.querySelector('[data-play-cta]');
      const tab = document.querySelector('.site-tab.is-active');
      const target = (cta && isVisible(cta)) ? cta
        : (tab && isVisible(tab)) ? tab
        : focusables[0];
      focusEl(target);
      return true;
    }

    if (focusCharSelectEdge(current, dir)) return true;

    const c = rectCenter(current);
    let best = null;
    let bestScore = Infinity;
    for (const el of focusables) {
      if (el === current) continue;
      const p = rectCenter(el);
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      let primary, secondary;
      if (dir === 'up')         { primary = -dy; secondary = Math.abs(dx); }
      else if (dir === 'down')  { primary =  dy; secondary = Math.abs(dx); }
      else if (dir === 'left')  { primary = -dx; secondary = Math.abs(dy); }
      else /* right */          { primary =  dx; secondary = Math.abs(dy); }
      // Must be in that direction at all.
      if (primary < 4) continue;
      // 45° cone: secondary must not exceed primary. This is what
      // keeps "left" from picking up-and-left elements when there's
      // nothing directly to the left, etc. Without it pressing left
      // when no in-row element exists steals focus to a row above
      // and reads as the press "going up".
      if (secondary > primary) continue;
      const score = primary + secondary * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { focusEl(best); return true; }
    return false;
  }

  // ── Range slider adjust (left/right while range is focused) ────
  function adjustRange(input, dir) {
    const step = parseFloat(input.step) || 1;
    const minRaw = parseFloat(input.min);
    const maxRaw = parseFloat(input.max);
    const val = parseFloat(input.value) || 0;
    const candidate = dir === 'left' ? val - step : val + step;
    const min = Number.isFinite(minRaw) ? minRaw : -Infinity;
    const max = Number.isFinite(maxRaw) ? maxRaw : Infinity;
    const next = Math.max(min, Math.min(max, candidate));
    if (next === val) return;
    input.value = String(next);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Activate / cancel ──────────────────────────────────────────
  function activateFocused() {
    const el = document.activeElement;
    if (!el) return;
    if (el.tagName === 'INPUT') {
      const t = el.type;
      // Range / text-like inputs don't get clicked; range is driven
      // by left/right and text fields are entered via the OS keyboard.
      if (t === 'range' || t === 'text' || t === 'search' || t === 'email'
          || t === 'password' || t === 'number' || t === 'tel' || t === 'url') {
        return;
      }
    }
    if (el.tagName === 'TEXTAREA') return;
    if (el.isContentEditable) return;
    if (typeof el.click === 'function') el.click();
  }

  function cancelOrBack() {
    // If a dialog is open, synthesize Escape so its existing close
    // handler runs.
    const openDialog = document.querySelector('dialog[open], .pause-card, .name-dialog-card, #finishDialogCard, #fpSkateOnboarding');
    if (openDialog && isVisible(openDialog)) {
      const evt = new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      });
      document.dispatchEvent(evt);
      return;
    }
    // Otherwise navigate back to home if we're not already there.
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/' && path !== '/home' && path !== '/home.html') {
      const homeTab = document.querySelector('.site-tab[data-tab="home"]');
      if (homeTab) homeTab.click();
    }
  }

  // ── Tab cycling (LB / RB) ───────────────────────────────────────
  // Detects three tab groups so LB/RB cycles whichever set the user is
  // currently working with: top-level page tabs, leaderboard mode tabs
  // (Normal/Speed/100%), and the settings-panel section tabs. Priority
  // when nothing's focused: most-specific (settings/mode) before the
  // global site nav.
  const TAB_GROUPS = [
    { container: '.settings-tabs', tab: '.settings-tab' },
    { container: '.modeTabs',     tab: '.modeTab' },
    { container: '.site-tabs',    tab: '.site-tab' },
  ];
  function cycleTab(delta) {
    const focused = document.activeElement;
    let group = null;
    if (focused) {
      for (const g of TAB_GROUPS) {
        const inGroup = (typeof focused.closest === 'function')
          ? focused.closest(g.container)
          : null;
        if (inGroup) { group = g; break; }
      }
    }
    if (!group) {
      for (const g of TAB_GROUPS) {
        if (document.querySelector(`${g.container} ${g.tab}`)) { group = g; break; }
      }
    }
    if (!group) return;
    const tabs = Array.from(document.querySelectorAll(`${group.container} ${group.tab}`))
      .filter(isVisible);
    if (tabs.length === 0) return;
    let idx = tabs.findIndex((t) =>
      t.classList.contains('is-active')
      || t.classList.contains('active')
      || t.getAttribute('aria-selected') === 'true');
    if (idx < 0) idx = 0;
    const next = tabs[((idx + delta) % tabs.length + tabs.length) % tabs.length];
    if (next) next.click();
  }

  // ── Direction edge / autorepeat ────────────────────────────────
  function dirEdge(active, key, now) {
    const wasLatched = dirLatch[key];
    if (active && !wasLatched) {
      dirLatch[key] = true;
      dirHoldStart[key] = now;
      dirLastRepeat[key] = now;
      return true;
    }
    if (active && wasLatched) {
      const heldFor = now - dirHoldStart[key];
      if (heldFor >= REPEAT_INITIAL_MS
          && now - dirLastRepeat[key] >= REPEAT_INTERVAL_MS) {
        dirLastRepeat[key] = now;
        return true;
      }
      return false;
    }
    if (!active && wasLatched) dirLatch[key] = false;
    return false;
  }

  // ── Polling ─────────────────────────────────────────────────────
  function shouldPoll() {
    if (activeIdx < 0) return false;
    // While the parent has promoted the iframe into play, the parent
    // copy of this script must yield: char-select runs in the iframe,
    // and the iframe's own copy will handle it.
    if (document.body.classList.contains('is-playing')) return false;
    // When the iframe is mounted as the home/about/leaderboard
    // background, its UI is hidden (`html.is-bg .panel,...{display:none}`)
    // and the parent owns nav. Don't double-handle.
    if (document.documentElement.classList.contains('is-bg')) return false;
    // When fpMode is active (in-game), game-fp.js's own _pollGamepad
    // owns input. game-fp toggles two authoritative signals on
    // toggleFirstPerson: html.is-ingame and window.__fpInGame.
    // Either being truthy means we yield. (#fpHud's inline display
    // proved unreliable as a proxy — CSS/other code can leave its
    // inline display empty even while the HUD is visible.)
    if (document.documentElement.classList.contains('is-ingame')) return false;
    if (window.__fpInGame) return false;
    return true;
  }

  // The about / leaderboard / settings pages set
  //   html { overflow:hidden; height:100% }  body { overflow-y:auto }
  // so the body is the scrolling element, not documentElement.
  // window.scrollBy() ends up scrolling whichever
  // document.scrollingElement points at, and Firefox returns body in
  // that layout while Chrome returns html. Pick the actual scroller
  // ourselves so right-stick scroll works the same in both browsers.
  function getScroller() {
    const candidates = [
      document.scrollingElement,
      document.body,
      document.documentElement,
    ];
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 1) return el;
    }
    return null;
  }

  function poll() {
    if (!shouldPoll()) {
      // Idle — don't keep a rAF burning. attachPad() restarts the
      // loop the moment a pad reconnects or play exits.
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(poll);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads[activeIdx];
    if (!pad || !pad.connected) return;

    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    const dt = lastPollTs ? Math.min(80, now - lastPollTs) : 16;
    lastPollTs = now;

    const lx = pad.axes[0] || 0;
    const ly = pad.axes[1] || 0;
    const ry = pad.axes[3] || 0;
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);

    // D-pad OR left stick beyond the threshold drives directional nav.
    const navUp    = btn(GP_DUP)    || ly < -DIR_THRESHOLD;
    const navDown  = btn(GP_DDOWN)  || ly >  DIR_THRESHOLD;
    const navLeft  = btn(GP_DLEFT)  || lx < -DIR_THRESHOLD;
    const navRight = btn(GP_DRIGHT) || lx >  DIR_THRESHOLD;

    const ae = document.activeElement;
    const isRange = ae && ae.tagName === 'INPUT' && ae.type === 'range';

    if (dirEdge(navUp,    'up',    now)) focusInDirection('up');
    if (dirEdge(navDown,  'down',  now)) focusInDirection('down');
    if (dirEdge(navLeft,  'left',  now)) {
      if (isRange) adjustRange(ae, 'left');
      else focusInDirection('left');
    }
    if (dirEdge(navRight, 'right', now)) {
      if (isRange) adjustRange(ae, 'right');
      else focusInDirection('right');
    }

    // Right-stick Y → page scroll. Useful on the leaderboard's long
    // run list and the settings panel. Skipped while a range is
    // focused so a slider's natural thumb glide doesn't fight scroll.
    if (Math.abs(ry) > SCROLL_DEADZONE) {
      const scroller = getScroller();
      if (scroller) {
        const dy = ry * SCROLL_PX_PER_SEC * (dt / 1000);
        scroller.scrollTop += dy;
      }
    }

    const pressed = (i) => btn(i) && !prevPressed[i];
    if (pressed(GP_A))     activateFocused();
    if (pressed(GP_B))     cancelOrBack();
    if (pressed(GP_LB))    cycleTab(-1);
    if (pressed(GP_RB))    cycleTab(+1);
    if (pressed(GP_START)) {
      const cta = document.querySelector('[data-play-cta]');
      if (cta && isVisible(cta)) cta.click();
    }

    for (let i = 0; i < pad.buttons.length; i++) prevPressed[i] = btn(i);
  }

  // ── Connect / disconnect ────────────────────────────────────────
  function attachPad(idx) {
    if (activeIdx >= 0) return;
    activeIdx = idx;
    document.body.classList.add('has-gamepad');
    // Initial landing focus so the user sees a focus ring as soon as
    // they touch the stick. Skip if focus already lives somewhere
    // sensible (e.g. they were typing).
    const ae = document.activeElement;
    if (!ae || ae === document.body || ae === document.documentElement) {
      const cta = document.querySelector('[data-play-cta]');
      const tab = document.querySelector('.site-tab.is-active');
      const target = (cta && isVisible(cta)) ? cta
        : (tab && isVisible(tab)) ? tab
        : null;
      if (target) focusEl(target);
    }
    if (!rafId) rafId = requestAnimationFrame(poll);
  }

  function detachPad(idx) {
    if (activeIdx !== idx) return;
    activeIdx = -1;
    document.body.classList.remove('has-gamepad');
    // Reset latches so a reconnect doesn't think a button is held.
    for (const k in dirLatch) dirLatch[k] = false;
    for (const k in prevPressed) prevPressed[k] = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  window.addEventListener('gamepadconnected', (e) => {
    attachPad(e.gamepad.index);
  });
  window.addEventListener('gamepaddisconnected', (e) => {
    detachPad(e.gamepad.index);
  });

  // Browsers don't expose pads until first user gesture or a real
  // input event. Sweep on load (covers Chrome, which exposes a stale
  // entry until something happens) and prime on first key/pointer
  // input as a backup.
  function sweep() {
    if (activeIdx >= 0) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.connected) { attachPad(p.index); return; }
    }
  }
  sweep();
  ['keydown', 'pointerdown'].forEach((evt) => {
    window.addEventListener(evt, function once() {
      window.removeEventListener(evt, once);
      sweep();
    }, { once: true });
  });

  // The iframe posts `play-exited` when the user closes /play in
  // place (Esc → exit). At that moment body.is-playing is dropped
  // by the parent's promotion handler, but our poll loop has been
  // idling since promotion started. Kick it back on so the pad keeps
  // working without forcing the user to press a button first.
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type !== 'play-exited') return;
    if (activeIdx >= 0 && !rafId) rafId = requestAnimationFrame(poll);
  });

  // Wake the loop whenever any of the suspend conditions flip off
  // without firing an event we already listen to. Two cases this
  // matters for, both inside the iframe:
  //   1. html.is-bg removed when the parent promotes /play into the
  //      foreground (char-select opens — we need to start handling
  //      input there).
  //   2. html.is-ingame removed when the user exits a run back to
  //      char-select / splash without a full page navigation
  //      (game-fp's pollGamepad goes silent; we need to take over
  //      again).
  // A single MutationObserver on <html> + <body> class attributes
  // covers both.
  if (typeof MutationObserver !== 'undefined') {
    const wake = () => {
      if (activeIdx >= 0 && !rafId && shouldPoll()) {
        rafId = requestAnimationFrame(poll);
      }
    };
    const mo = new MutationObserver(wake);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
})();
