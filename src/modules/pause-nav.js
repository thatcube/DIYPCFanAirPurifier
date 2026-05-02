// pause-nav.js
// Drives the in-pause "drill-down" navigation: launcher ↔ settings,
// animating the same .pause-card container between the two views
// using FLIP (First, Last, Invert, Play).
//
// Why FLIP and not transition-on-natural-size?
//   `transition: width auto` doesn't work — `auto` isn't an
//   animatable value in any browser today. So we have to bridge two
//   known dimensions with explicit pixel values.
//
// The previous version of this file had a subtle but visible bug:
// it added the `.is-morphing` class BEFORE measuring the target
// size, so measurement happened with neither rest-state width rule
// applying. The card fell back to its base `width: max-content`
// rule, which gave a measurement that didn't match the post-morph
// CSS rest size — producing the "snap" the user saw at the end.
//
// The fix: do real FLIP. Apply the FINAL DOM/CSS state first, take
// `getBoundingClientRect()` (that's the true rest size we're
// animating toward), then INVERT back to the start dims, then PLAY.
// Combined with moving per-view widths off the card and onto the
// views themselves (so the card always shrink-wraps to whichever
// view is in flow), measurement is guaranteed to equal rest state.
//
// Honors prefers-reduced-motion: in that mode we just swap, no
// dimension morph and no slide / blur — fade only.

import { mountSettings } from './settings-panel.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Tuning. Under 300ms per Emil Kowalski's UI-animation rule of thumb;
// `cubic-bezier(.22,1,.36,1)` is a custom ease-out variant that
// starts fast (responsive feel) and settles gently (no overshoot).
const DUR = REDUCED ? 0 : 280;
const EASE = 'cubic-bezier(.22,1,.36,1)';

let _card = null;
let _views = null;
let _settingsMounted = false;
let _animating = false;

function _init() {
  if (_card) return;
  _card = document.querySelector('.pause-card--nav');
  if (!_card) return;
  _views = {
    launcher: _card.querySelector('.pause-view--launcher'),
    settings: _card.querySelector('.pause-view--settings'),
  };

  // Click delegation for the two drill actions. Bound to the card
  // (not document) so we don't fight with other global handlers.
  _card.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    if (action === 'pause-settings') {
      e.preventDefault();
      navigate('settings');
    } else if (action === 'pause-back') {
      e.preventDefault();
      navigate('launcher');
    }
  });
}

// Public-ish: set the launcher as the active view without animating.
// Called whenever the pause overlay opens, so the user always lands
// on the launcher (drilling into settings is per-pause-session).
export function resetToLauncher() {
  _init();
  if (!_card) return;
  _card.dataset.pauseView = 'launcher';
  if (_views.launcher) {
    _views.launcher.hidden = false;
    _views.launcher.removeAttribute('data-state');
    _views.launcher.classList.remove('is-out-of-flow');
  }
  if (_views.settings) {
    _views.settings.hidden = true;
    _views.settings.removeAttribute('data-state');
    _views.settings.classList.remove('is-out-of-flow');
  }
  _card.classList.remove('is-morphing');
  _card.style.width = '';
  _card.style.height = '';
  _card.style.transition = '';
}

function navigate(target) {
  _init();
  if (!_card || !_views[target]) return;
  if (_animating) return;
  const current = _card.dataset.pauseView || 'launcher';
  if (current === target) return;

  // Lazy-mount the settings panel the first time we drill in. Its
  // schema picks up live state and self-syncs via the
  // `settings-panel:mounted` event main.js listens for.
  if (target === 'settings' && !_settingsMounted) {
    const host = _card.querySelector('#pauseSettingsHost');
    if (host) {
      mountSettings(host);
      _settingsMounted = true;
    }
  }

  // forward = drilling deeper (launcher → settings)
  // back    = drilling out  (settings → launcher)
  const forward = target === 'settings';
  const outgoing = _views[current];
  const incoming = _views[target];

  if (REDUCED) {
    outgoing.hidden = true;
    outgoing.classList.remove('is-out-of-flow');
    incoming.hidden = false;
    _card.dataset.pauseView = target;
    return;
  }

  _animating = true;

  // ── FIRST ──────────────────────────────────────────────────────
  // Snapshot the card's current bounds. Use BCR for subpixel values
  // — animation precision matters a lot at the seam.
  const startRect = _card.getBoundingClientRect();

  // ── LAST ───────────────────────────────────────────────────────
  // Apply the FINAL DOM/CSS state. Outgoing goes out of flow so
  // the card auto-sizes to incoming alone. dataset.pauseView flips
  // so any data-attribute-driven CSS rules use their target values.
  // Crucially, we do NOT add `.is-morphing` yet — we want the card
  // measured under the same CSS conditions it'll have at rest.
  outgoing.classList.add('is-out-of-flow');
  incoming.hidden = false;
  _card.dataset.pauseView = target;
  _card.style.width = '';
  _card.style.height = '';
  _card.style.transition = 'none';

  // Measure the true rest size of the target view.
  const endRect = _card.getBoundingClientRect();

  // ── INVERT ─────────────────────────────────────────────────────
  // Lock the card's box back to its starting dimensions. Now add
  // `.is-morphing` (which gates the content cross-fade keyframes)
  // and arm the directional state attrs on each view.
  _card.classList.add('is-morphing');
  _card.style.width = startRect.width + 'px';
  _card.style.height = startRect.height + 'px';
  outgoing.dataset.state = 'exit-' + (forward ? 'back' : 'forward');
  incoming.dataset.state = 'enter-from-' + (forward ? 'forward' : 'back');

  // Force a reflow to commit the inverted dims before we attach the
  // transition (otherwise the browser may collapse the change).
  void _card.offsetWidth;

  // ── PLAY ───────────────────────────────────────────────────────
  _card.style.transition = `width ${DUR}ms ${EASE}, height ${DUR}ms ${EASE}`;
  requestAnimationFrame(() => {
    _card.style.width = endRect.width + 'px';
    _card.style.height = endRect.height + 'px';
    incoming.dataset.state = 'enter-active';
  });

  // ── CLEANUP ────────────────────────────────────────────────────
  // Wait for both width AND height transitions to finish. Failsafe
  // timeout in case transitionend doesn't fire (e.g. the card was
  // hidden mid-animation, or one dimension didn't actually change).
  let pending = 2;
  let finished = false;
  const onEnd = (e) => {
    if (e.target !== _card) return;
    if (e.propertyName !== 'width' && e.propertyName !== 'height') return;
    pending--;
    if (pending <= 0) finish();
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    _card.removeEventListener('transitionend', onEnd);
    _card.style.transition = '';
    _card.style.width = '';
    _card.style.height = '';
    outgoing.classList.remove('is-out-of-flow');
    outgoing.removeAttribute('data-state');
    outgoing.hidden = true;
    incoming.removeAttribute('data-state');
    _card.classList.remove('is-morphing');
    _animating = false;
    // Move keyboard focus into the new view for accessibility.
    const focusTarget = incoming.querySelector(
      target === 'settings' ? '.pause-back' : '.pause-btn--hero'
    );
    if (focusTarget && typeof focusTarget.focus === 'function') {
      try { focusTarget.focus({ preventScroll: true }); } catch (e) { }
    }
  };
  _card.addEventListener('transitionend', onEnd);
  setTimeout(finish, DUR + 80);
}

// Keyboard: pressing Esc while inside the Settings drill-down should
// pop back to the Launcher (rather than unpausing the game). Handled
// in capture phase to beat game-fp.js's document-level Escape that
// would otherwise unpause.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  _init();
  if (!_card) return;
  const overlay = document.getElementById('fpPauseOverlay');
  const visible = overlay && overlay.style.display && overlay.style.display !== 'none';
  if (!visible) return;
  if (_card.dataset.pauseView !== 'settings') return;
  // If the user is actively typing in the search input AND it has
  // text, let the search-input handler clear the field instead.
  const target = e.target;
  if (target && target.classList && target.classList.contains('settings-search-input')) {
    if (target.value !== '') return;
  }
  e.stopPropagation();
  e.preventDefault();
  navigate('launcher');
}, true);

// Initial wiring on first load.
_init();

// Watch the pause overlay so we always land on the launcher view
// when the user pauses (even if they had drilled into Settings the
// previous time). MutationObserver on the overlay's inline style
// attribute means we don't have to touch game-fp.js's setPaused.
(function _watchOverlay() {
  const overlay = document.getElementById('fpPauseOverlay');
  if (!overlay) return;
  let lastVisible = overlay.style.display && overlay.style.display !== 'none';
  const obs = new MutationObserver(() => {
    const nowVisible = overlay.style.display && overlay.style.display !== 'none';
    if (nowVisible && !lastVisible) {
      resetToLauncher();
    }
    lastVisible = nowVisible;
  });
  obs.observe(overlay, { attributes: true, attributeFilter: ['style'] });
})();
