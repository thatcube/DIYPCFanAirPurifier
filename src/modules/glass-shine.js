// ═══════════════════════════════════════════════════════════════════
//  glass-shine.js — Cursor-tracking specular highlight, click ripple,
//  and 3D tilt effect for glass buttons. Pure DOM — no dependencies.
// ═══════════════════════════════════════════════════════════════════

const SELECTOR = '#playDockBtn, .char-start, .pause-btn, .finishDlgBtn, .pause-pill';
const TILT_MAX = 8; // degrees

// ── Shine (mouse-tracking highlight) ────────────────────────────────

function _ensureShine(el) {
  if (el._glassShine) return el._glassShine;
  const shine = document.createElement('div');
  shine.className = 'glass-shine';
  // Only set position if the element doesn't already have one in CSS
  const computed = getComputedStyle(el).position;
  if (computed === 'static') el.style.position = 'relative';
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

  // 3D tilt — rotate toward cursor
  const cx = (e.clientX - rect.left) / rect.width - 0.5;  // -0.5 to 0.5
  const cy = (e.clientY - rect.top) / rect.height - 0.5;
  const rotY = cx * TILT_MAX;
  const rotX = -cy * TILT_MAX;
  // Preserve existing translateX(-50%) for centered buttons
  const base = el._glassBaseTransform || '';
  el.style.transform = base + ` perspective(400px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
}

function _onMouseEnter(e) {
  const el = e.currentTarget;
  // Capture the base CSS transform before we modify it
  if (!el._glassBaseTransform) {
    el._glassBaseTransform = getComputedStyle(el).transform;
    if (el._glassBaseTransform === 'none') el._glassBaseTransform = '';
    // For #playDockBtn, the CSS uses translateX(-50%) which becomes a matrix
    // Just store the CSS rule value instead
    const rawTransform = el.style.transform || '';
    el._glassBaseTransform = rawTransform;
  }
}

function _onMouseLeave(e) {
  const el = e.currentTarget;
  const shine = el._glassShine;
  if (shine) shine.style.opacity = '0';
  // Reset tilt
  el.style.transform = el._glassBaseTransform || '';
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
  _attachAll();
  const obs = new MutationObserver(() => _attachAll());
  obs.observe(document.body, { childList: true, subtree: true });
}

function _attachAll() {
  document.querySelectorAll(SELECTOR).forEach(el => {
    if (el._glassShineAttached) return;
    el._glassShineAttached = true;
    el.addEventListener('mouseenter', _onMouseEnter);
    el.addEventListener('mousemove', _onMouseMove);
    el.addEventListener('mouseleave', _onMouseLeave);
    el.addEventListener('pointerdown', _onPointerDown);
    _ensureShine(el);
  });
}
