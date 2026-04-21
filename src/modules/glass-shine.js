// ═══════════════════════════════════════════════════════════════════
//  glass-shine.js — Cursor-tracking specular highlight, click ripple,
//  border glow, and press spring for glass buttons.
// ═══════════════════════════════════════════════════════════════════

const SELECTOR = '#playDockBtn, .char-start, .pause-btn, .finishDlgBtn, .pause-pill';

// ── Shine (mouse-tracking highlight) ────────────────────────────────

function _ensureShine(el) {
  if (el._glassShine) return el._glassShine;
  const shine = document.createElement('div');
  shine.className = 'glass-shine';
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

  // Border glow — shift the box-shadow glow toward the cursor
  const nx = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
  const ny = (e.clientY - rect.top) / rect.height - 0.5;
  const glowX = nx * 16;
  const glowY = ny * 12;
  el.style.boxShadow = `${glowX}px ${glowY}px 28px rgba(160,200,255,0.18), inset 0 1px 0 rgba(255,255,255,0.22)`;
}

function _onMouseLeave(e) {
  const el = e.currentTarget;
  const shine = el._glassShine;
  if (shine) shine.style.opacity = '0';
  el.style.boxShadow = '';
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

  // Press spring — quick scale down then bounce back via CSS
  el.classList.add('glass-pressed');
  el.addEventListener('animationend', function onEnd() {
    el.classList.remove('glass-pressed');
    el.removeEventListener('animationend', onEnd);
  }, { once: true });
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
    _ensureShine(el);
  });
}
