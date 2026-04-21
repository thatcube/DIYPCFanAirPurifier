// ═══════════════════════════════════════════════════════════════════
//  glass-shine.js — Cursor-tracking specular highlight + click ripple
//  Adds a "light following the mouse" effect to glass buttons, plus
//  an expanding ring on click. Pure DOM — no dependencies.
// ═══════════════════════════════════════════════════════════════════

const SELECTOR = '#playDockBtn, .char-start, .pause-btn, .finishDlgBtn, .pause-pill';

// ── Shine (mouse-tracking highlight) ────────────────────────────────

function _ensureShine(el) {
  if (el._glassShine) return el._glassShine;
  const shine = document.createElement('div');
  shine.className = 'glass-shine';
  el.style.position = el.style.position || 'relative';
  el.appendChild(shine);
  el._glassShine = shine;
  return shine;
}

function _onMouseMove(e) {
  const el = e.currentTarget;
  const shine = _ensureShine(el);
  const rect = el.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  shine.style.setProperty('--shine-x', x + '%');
  shine.style.setProperty('--shine-y', y + '%');
}

function _onMouseLeave(e) {
  const shine = e.currentTarget._glassShine;
  if (shine) shine.style.opacity = '0';
}

// ── Ripple (click expanding ring) ───────────────────────────────────

function _onPointerDown(e) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const size = Math.max(rect.width, rect.height) * 2.5;

  const ripple = document.createElement('div');
  ripple.className = 'glass-ripple';
  ripple.style.width = size + 'px';
  ripple.style.height = size + 'px';
  ripple.style.left = (x - size / 2) + 'px';
  ripple.style.top = (y - size / 2) + 'px';
  el.appendChild(ripple);

  ripple.addEventListener('animationend', () => ripple.remove());
}

// ── Init: attach to all matching buttons ────────────────────────────

export function initGlassShine() {
  // Initial buttons
  _attachAll();

  // Watch for dynamically created buttons (leaderboard dialogs, etc.)
  const obs = new MutationObserver(() => _attachAll());
  obs.observe(document.body, { childList: true, subtree: true });
}

function _attachAll() {
  document.querySelectorAll(SELECTOR).forEach(el => {
    if (el._glassShineAttached) return;
    el._glassShineAttached = true;
    el.addEventListener('mousemove', _onMouseMove);
    el.addEventListener('mouseleave', _onMouseLeave);
    el.addEventListener('pointerdown', _onPointerDown);
    _ensureShine(el);
  });
}
