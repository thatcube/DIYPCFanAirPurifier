// ═══════════════════════════════════════════════════════════════════
//  glass-shine.js — Cursor-tracking specular highlight, click ripple,
//  and cursor-following glow for glass buttons.
// ═══════════════════════════════════════════════════════════════════

const SELECTOR = '.glass-btn, .pause-pill';

// ── Shine + Glow (mouse-tracking highlight) ─────────────────────────

function _ensureOverlays(el) {
  if (el._glassShine) return;
  const computed = getComputedStyle(el).position;
  if (computed === 'static') el.style.position = 'relative';

  // Shine: radial spotlight that follows cursor
  const shine = document.createElement('div');
  shine.className = 'glass-shine';
  el.appendChild(shine);
  el._glassShine = shine;

  // Glow: soft colored shadow that follows cursor (rendered as an overlay
  // so we never touch el.style.boxShadow and don't fight CSS :hover)
  const glow = document.createElement('div');
  glow.className = 'glass-glow';
  el.appendChild(glow);
  el._glassGlow = glow;
}

function _onMouseMove(e) {
  const el = e.currentTarget;
  _ensureOverlays(el);
  const rect = el.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  el._glassShine.style.setProperty('--shine-x', x + '%');
  el._glassShine.style.setProperty('--shine-y', y + '%');
  el._glassGlow.style.setProperty('--glow-x', x + '%');
  el._glassGlow.style.setProperty('--glow-y', y + '%');
}

function _onMouseLeave(e) {
  const el = e.currentTarget;
  if (el._glassShine) el._glassShine.style.opacity = '0';
  if (el._glassGlow) el._glassGlow.style.opacity = '0';
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

// ── Init ─────────────────────────────────────────────────────────────

export function initGlassShine() {
  _attachAll();
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
    _ensureOverlays(el);
  });
}
